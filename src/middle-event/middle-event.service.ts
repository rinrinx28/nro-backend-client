import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SocketGateway } from 'src/socket/socket.gateway';
import { BotStatuEvent, NoticeInfoEvent } from './dto/dto.event';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/user/schema/user.schema';
import { UserActive } from 'src/user/schema/userActive.schema';
import { MiniGame } from './schema/mini.schema';
import { ResultMiniGame } from './schema/result.schema';
import { EConfig } from './schema/config.schema';
import { UserBet } from 'src/user/schema/userBet.schema';
import { Message } from 'src/user/schema/message.schema';
import { Bot } from 'src/bot/schema/bot.schema';
import { Clan } from './schema/clan.schema';
import { Mutex } from 'async-mutex';
import * as moment from 'moment';
import { Jackpot } from './schema/jackpot';
import { Cron } from './schema/cron.schema';
import { HttpService } from '@nestjs/axios';

interface IData {
  uuid: string;
  server: string;
  content: string;
}

@Injectable()
export class MiddleEventService {
  constructor(
    private readonly socketGateway: SocketGateway,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(UserActive.name)
    private readonly userActiveModel: Model<UserActive>,
    @InjectModel(MiniGame.name)
    private readonly miniGameModel: Model<MiniGame>,
    @InjectModel(UserBet.name)
    private readonly userBetModel: Model<UserBet>,
    @InjectModel(ResultMiniGame.name)
    private readonly resultMiniGameModel: Model<ResultMiniGame>,
    @InjectModel(EConfig.name)
    private readonly eConfigModel: Model<EConfig>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,
    @InjectModel(Bot.name)
    private readonly botModel: Model<Bot>,
    @InjectModel(Clan.name)
    private readonly clanModel: Model<Clan>,
    @InjectModel(Jackpot.name)
    private readonly JackpotModel: Model<Jackpot>,
    @InjectModel(Cron.name)
    private readonly cronModel: Model<Cron>,
    private readonly httpService: HttpService,
  ) {}
  private logger: Logger = new Logger('Middle Handler');
  private readonly mutexMap = new Map<string, Mutex>();

  private KeyConfig = [
    { key: 'CT', name: 'Chẵn Tài' },
    { key: 'LT', name: 'Lẻ Tài' },
    { key: 'CX', name: 'Chẵn Xỉu' },
    { key: 'LX', name: 'Lẻ Xỉu' },
  ];

  show_result_text(res: string) {
    return this.KeyConfig.find((k) => k.key === res).name;
  }

  @OnEvent('bot.status', { async: true })
  async handleBotStatus(payload: BotStatuEvent) {
    const bot = await this.botModel.findOneAndUpdate(
      { id: payload.id },
      payload,
      { new: true, upsert: true },
    );
    this.socketGateway.server.emit('bot.status', bot);
  }

  @OnEvent('notice.info', { async: true })
  async handleNoticeInfo(payload: NoticeInfoEvent) {
    // Note: Remove using data from game client
    // await this.miniGameClient(payload);
    return null;
  }

  @OnEvent('mini.bet.info', { async: true })
  async handlerMiniInfo(server: string) {
    try {
      const n_game = await this.miniGameModel
        .findOne({ server: server })
        .sort({ updatedAt: -1 });
      if (n_game) {
        this.socketGateway.server.emit('mini.bet', {
          n_game: n_game.toObject(),
        });
      }
    } catch (err: any) {
      this.logger.log(`Err Mini BET Info: Msg: ${err.message}`);
      this.socketGateway.server.emit('mini.bet', { err: err.message });
    }
  }

  @OnEvent('mini.server.24', { async: true })
  async handleMiniServer24(status: string) {
    try {
      // Note: Tìm game cũ chưa kết thúc để xử lý, ưu tiên game mới nhất dựa trên updatedAt
      let old_game = await this.miniGameModel
        .findOne({ isEnd: false, server: '24' })
        .sort({ updatedAt: -1 });

      // Note: Nếu không có old_game (lần đầu chạy hoặc hết thời gian), tạo game mới
      if (!old_game) {
        // Note: Lấy 10 kết quả mini game gần nhất để hiển thị lịch sử
        const old_r_game = await this.resultMiniGameModel
          .find()
          .sort({ updatedAt: -1 })
          .limit(10);

        // Note: Tạo game mới với thời gian kết thúc sau 60 giây
        const n_game = await this.handlerCreate({
          server: '24',
          timeEnd: this.addSeconds(new Date(), 60),
          uuid: 'local',
          lastResult: old_r_game.map((r) => r.result).join('-'), // Lịch sử kết quả dạng chuỗi
        });

        // Note: Gửi thông tin game mới qua socket tới tất cả client
        this.socketGateway.server.emit('mini.bet', {
          n_game: n_game.toObject(),
        });
        return; // Thoát hàm sau khi tạo game mới
      }

      // Note: Nếu có old_game, lấy kết quả từ resultMiniGameModel
      const res = await this.resultMiniGameModel.findOne({
        miniId: old_game.id,
      });
      if (!res)
        throw new Error('Đã xảy ra lỗi đối với hệ thống tính toán phần thưởng'); // Note: Kiểm tra lỗi nếu không tìm thấy kết quả

      // Note: Đánh dấu game cũ là đã kết thúc và lưu kết quả
      old_game.isEnd = true;
      old_game.result = res.result;
      await old_game.save();
      await this.sendLogsServerDiscord(
        `Kết thúc phiên Bet sv: 24 
        \n- betId: ${old_game.id} 
        \n- Kết quả: ${res.result} 
        \n- Thời gian kết thúc: ${new Date(`${old_game.timeEnd}`).toLocaleString()}`,
      );

      // Note: Chuyển đổi kết quả thành định dạng hiển thị (e.g., "12_[kq]")
      const s_res = this.showResult(res.result);

      // Note: Lấy cấu hình tỷ lệ cược từ eConfigModel
      const e_bet = await this.eConfigModel.findOne({ name: 'e_bet' });
      const { cl = 1.95, x = 3.2, g = 70 } = e_bet.option; // Default values nếu không có config

      // Note: Lấy tất cả user bet chưa kết thúc trong game này
      const users_bet = await this.userBetModel.find({
        betId: old_game.id,
        isEnd: false,
      });

      // Note: Cập nhật tất cả user bets đồng thời và tìm người thắng
      const { userBets, users } = await this.updateUserBets(
        users_bet,
        res,
        cl,
        x,
        g,
        s_res,
      );

      // Note: Lấy thông tin user từ danh sách người thắng
      const list_user = await this.userModel.find({
        _id: { $in: users.map((u) => u.uid) },
      });

      // Note: Cập nhật tiền, meta, clan và lưu hoạt động của user
      const { userActives, clans, users_res } = await this.updateUsersAndClans(
        users,
        list_user,
        old_game.id,
      );

      // Note: Cập nhật điểm clan bằng bulkWrite để tối ưu hiệu suất
      const bulkOpsClan = clans.map((clan) => ({
        updateOne: {
          filter: { _id: clan.clanId },
          update: { $inc: { score: clan.score } },
        },
      }));
      // Note: Thực hiện cập nhật clans và user activities song song, đảm bảo userActives luôn chạy kể cả khi không có clans
      const clans_bulk_promise = bulkOpsClan.length
        ? this.clanModel.bulkWrite(bulkOpsClan) // Note: Chỉ cập nhật clan nếu có dữ liệu
        : Promise.resolve(null); // Note: Trả về null nếu không có clan để cập nhật

      const active_promise = userActives.length
        ? this.userActiveModel.insertMany(userActives) // Note: Lưu tất cả activity nếu có
        : Promise.resolve([]); // Note: Trả về mảng rỗng nếu không có activity

      // Note: Chờ cả hai promise hoàn tất, nhưng không phụ thuộc lẫn nhau
      const [clans_bulk, active_result] = await Promise.all([
        clans_bulk_promise,
        active_promise,
      ]);

      // Note: Gửi thông báo kết quả và thông báo thắng lớn qua hệ thống
      await this.sendNotifications(old_game, s_res, users);

      // Note: Nếu kết quả là "99", kích hoạt jackpot
      if (res.result === '99') {
        await this.sendJackpot({ server: '24', betId: old_game.id });
      }

      // Note: Tạo game mới sau khi xử lý xong game cũ
      const last_res = await this.resultMiniGameModel
        .find()
        .sort({ updatedAt: -1 })
        .limit(10);
      const n_game = await this.handlerCreate({
        server: '24',
        timeEnd: this.addSeconds(new Date(), 60),
        uuid: 'local',
        lastResult: last_res.map((r) => r.result).join('-'),
      });

      // Note: Chuẩn bị payload để gửi qua socket: game mới, kết quả bet, thông tin user
      const payload = {
        n_game: n_game.toObject(),
        userBets, // Danh sách các bet đã cập nhật
        data_user: users_res, // Thông tin user sau khi cập nhật tiền
      };

      // Note: Gửi thông tin cập nhật qua socket cho client
      this.socketGateway.server.emit('mini.bet', payload);

      // Note: Clans hiện đang không kích hoạt trên FE
      // if (clans_bulk) {
      //   this.socketGateway.server.emit('clan.update.bulk', clans_bulk); // Note: Cập nhật clan cho client
      // }

      return payload; // Note: Trả về payload để debug hoặc xử lý tiếp nếu cần
    } catch (err: any) {
      // Note: Ghi log lỗi tổng quát để dễ dàng theo dõi khi debug
      this.logger.log(`Err BET 24: ${err.message} - Stack: ${err.stack}`);
      throw err; // Note: Ném lỗi để caller xử lý hoặc dừng luồng
    }
  }

  @OnEvent('main.server', { async: true })
  async handleMainServer(server: string) {
    try {
      // Note: Tìm game cũ chưa kết thúc để xử lý, ưu tiên game mới nhất dựa trên updatedAt
      let old_game = await this.miniGameModel
        .findOne({ isEnd: false, server: server })
        .sort({ updatedAt: -1 });

      // Note: Nếu không có old_game (lần đầu chạy hoặc hết thời gian), tạo game mới
      if (!old_game) {
        // Note: Lấy 10 kết quả mini game gần nhất để hiển thị lịch sử
        const old_r_game = await this.resultMiniGameModel
          .find()
          .sort({ updatedAt: -1 })
          .limit(10);

        // Note: Tạo game mới với thời gian kết thúc sau 60 giây
        const n_game = await this.handlerCreate({
          server: server,
          timeEnd: this.addSeconds(new Date(), 280),
          uuid: 'local',
          lastResult: old_r_game.map((r) => r.result).join('-'), // Lịch sử kết quả dạng chuỗi
        });

        // Note: Gửi thông tin game mới qua socket tới tất cả client
        this.socketGateway.server.emit('mini.bet', {
          n_game: n_game.toObject(),
        });
        return; // Thoát hàm sau khi tạo game mới
      }

      // Note: Nếu có old_game, lấy kết quả từ resultMiniGameModel
      const res = await this.resultMiniGameModel.findOne({
        miniId: old_game.id,
      });
      if (!res)
        throw new Error('Đã xảy ra lỗi đối với hệ thống tính toán phần thưởng'); // Note: Kiểm tra lỗi nếu không tìm thấy kết quả

      // Note: Đánh dấu game cũ là đã kết thúc và lưu kết quả
      old_game.isEnd = true;
      old_game.result = res.result;
      await old_game.save();
      await this.sendLogsServerDiscord(
        `Kết thúc phiên Bet sv: ${server}
        \n- betId: ${old_game.id} 
        \n- Kết quả: ${res.result} 
        \n- Thời gian kết thúc: ${new Date(`${old_game.timeEnd}`).toLocaleString()}`,
      );

      // Note: Chuyển đổi kết quả thành định dạng hiển thị (e.g., "12_[kq]")
      const s_res = this.showResult(res.result);

      // Note: Lấy cấu hình tỷ lệ cược từ eConfigModel
      const e_bet = await this.eConfigModel.findOne({ name: 'e_bet' });
      const { cl = 1.95, x = 3.2, g = 70 } = e_bet.option; // Default values nếu không có config

      // Note: Lấy tất cả user bet chưa kết thúc trong game này
      const users_bet = await this.userBetModel.find({
        betId: old_game.id,
        isEnd: false,
      });

      // Note: Cập nhật tất cả user bets đồng thời và tìm người thắng
      const { userBets, users } = await this.updateUserBets(
        users_bet,
        res,
        cl,
        x,
        g,
        s_res,
      );

      // Note: Lấy thông tin user từ danh sách người thắng
      const list_user = await this.userModel.find({
        _id: { $in: users.map((u) => u.uid) },
      });

      // Note: Cập nhật tiền, meta, clan và lưu hoạt động của user
      const { userActives, clans, users_res } = await this.updateUsersAndClans(
        users,
        list_user,
        old_game.id,
      );

      // Note: Cập nhật điểm clan bằng bulkWrite để tối ưu hiệu suất
      const bulkOpsClan = clans.map((clan) => ({
        updateOne: {
          filter: { _id: clan.clanId },
          update: { $inc: { score: clan.score } },
        },
      }));
      // Note: Thực hiện cập nhật clans và user activities song song, đảm bảo userActives luôn chạy kể cả khi không có clans
      const clans_bulk_promise = bulkOpsClan.length
        ? this.clanModel.bulkWrite(bulkOpsClan) // Note: Chỉ cập nhật clan nếu có dữ liệu
        : Promise.resolve(null); // Note: Trả về null nếu không có clan để cập nhật

      const active_promise = userActives.length
        ? this.userActiveModel.insertMany(userActives) // Note: Lưu tất cả activity nếu có
        : Promise.resolve([]); // Note: Trả về mảng rỗng nếu không có activity

      // Note: Chờ cả hai promise hoàn tất, nhưng không phụ thuộc lẫn nhau
      const [clans_bulk, active_result] = await Promise.all([
        clans_bulk_promise,
        active_promise,
      ]);

      // Note: Gửi thông báo kết quả và thông báo thắng lớn qua hệ thống
      await this.sendNotifications(old_game, s_res, users);

      // Note: Nếu kết quả là "99", kích hoạt jackpot
      // if (res.result === '99') {
      //   await this.sendJackpot({ server: server, betId: old_game.id });
      // }

      // Note: Tạo game mới sau khi xử lý xong game cũ
      const last_res = await this.resultMiniGameModel
        .find()
        .sort({ updatedAt: -1 })
        .limit(10);
      const n_game = await this.handlerCreate({
        server: server,
        timeEnd: this.addSeconds(new Date(), 60),
        uuid: 'local',
        lastResult: last_res.map((r) => r.result).join('-'),
      });

      // Note: Chuẩn bị payload để gửi qua socket: game mới, kết quả bet, thông tin user
      const payload = {
        n_game: n_game.toObject(),
        userBets, // Danh sách các bet đã cập nhật
        data_user: users_res, // Thông tin user sau khi cập nhật tiền
      };

      // Note: Gửi thông tin cập nhật qua socket cho client
      this.socketGateway.server.emit('mini.bet', payload);

      // Note: Clans hiện đang không kích hoạt trên FE
      // if (clans_bulk) {
      //   this.socketGateway.server.emit('clan.update.bulk', clans_bulk); // Note: Cập nhật clan cho client
      // }

      return payload; // Note: Trả về payload để debug hoặc xử lý tiếp nếu cần
    } catch (err: any) {
      // Note: Ghi log lỗi tổng quát để dễ dàng theo dõi khi debug
      this.logger.log(
        `Err BET ${server}: ${err.message} - Stack: ${err.stack}`,
      );
      throw err; // Note: Ném lỗi để caller xử lý hoặc dừng luồng
    }
  }

  // Note: Hàm phụ để cập nhật user bets và tìm người thắng
  async updateUserBets(
    users_bet: any[],
    res: any,
    cl: number,
    x: number,
    g: number,
    s_res: string,
  ) {
    const userBets: any[] = [];
    const users: {
      uid: string;
      revice: number;
      place: string;
      amount: number;
      name: string;
    }[] = [];

    // Note: Dùng Promise.all để xử lý đồng thời tất cả user bets
    const updatePromises = users_bet.map(async (user_bet) => {
      const { place, typeBet, amount, uid, meta } = user_bet;
      let rate: number;
      let isWinner = false;

      // Note: Xác định tỷ lệ và điều kiện thắng dựa trên loại cược
      if (typeBet === 'cl') {
        rate = cl;
        const isRes = parseInt(res.result, 10);
        if (isRes % 2 === 0 && place === 'C')
          isWinner = true; // Chẵn
        else if (isRes % 2 !== 0 && place === 'L')
          isWinner = true; // Lẻ
        else if (isRes <= 49 && place === 'X')
          isWinner = true; // Xỉu
        else if (isRes >= 50 && place === 'T') isWinner = true; // Tài
      } else if (typeBet === 'x') {
        // Xiên
        rate = x;
        isWinner = s_res.split('_')[0] === place; // Note: So sánh với phần đầu của kết quả
      } else {
        // Dự đoán số
        rate = g;
        isWinner = s_res.split('_')[1] === place; // Note: So sánh với phần sau của kết quả
      }

      // Note: Nếu thắng, tính tiền thưởng và thêm vào danh sách người thắng
      if (isWinner) {
        user_bet.revice = amount * rate;
        users.push({
          uid,
          revice: user_bet.revice,
          place,
          amount,
          name: meta.name,
        });
      }

      // Note: Cập nhật trạng thái bet (đã kết thúc) và lưu vào DB
      user_bet.isEnd = true;
      user_bet.status = 2; // Note: Status 2 biểu thị bet đã hoàn tất
      user_bet.result = res.result;
      await user_bet.save();
      userBets.push(user_bet.toObject());
    });

    await Promise.all(updatePromises);
    return { userBets, users };
  }

  // Note: Hàm phụ để cập nhật thông tin user và clan, hỗ trợ user thắng nhiều userbet
  async updateUsersAndClans(users: any[], list_user: any[], betId: string) {
    const userActives: any[] = [];
    const clans: { clanId: string; score: number }[] = [];
    const users_res: { _id: string; money: number }[] = [];

    // Note: Tạo map để gộp tất cả khoản thắng của từng user theo uid
    const winningsByUser = new Map<
      string,
      { totalRevice: number; wins: any[] }
    >();
    for (const win of users) {
      const { uid, revice, place, amount } = win;
      if (winningsByUser.has(uid)) {
        const existing = winningsByUser.get(uid)!;
        existing.totalRevice += revice;
        existing.wins.push({ revice, place, amount });
      } else {
        winningsByUser.set(uid, {
          totalRevice: revice,
          wins: [{ revice, place, amount }],
        });
      }
    }

    // Note: Dùng Promise.all để cập nhật đồng thời tất cả user
    const updatePromises = list_user.map(async (user) => {
      const userWins = winningsByUser.get(user.id);
      if (userWins) {
        const { totalRevice, wins } = userWins;

        // Note: Cộng tổng tiền thưởng từ tất cả userbet thắng vào tài khoản
        user.money += totalRevice;
        user.meta.totalTrade += totalRevice; // Note: Cập nhật tổng giao dịch
        user.meta.limitTrade += totalRevice; // Note: Cập nhật giới hạn giao dịch

        // Note: Nếu user thuộc clan, cập nhật điểm clan dựa trên tổng tiền thắng
        if (user.meta.clanId) {
          user.meta.score += totalRevice;
          const clanIdx = clans.findIndex((c) => c.clanId === user.meta.clanId);
          if (clanIdx > 0) {
            clans[clanIdx].score += totalRevice;
          }
        }

        // Note: Đánh dấu meta đã thay đổi để mongoose lưu đúng
        user.markModified('meta');
        await user.save();

        // Note: Thêm thông tin user vào kết quả trả về
        users_res.push({ _id: user.id, money: user.money });

        // Note: Ghi lại hoạt động cho từng session thắng của user
        wins.forEach((win) => {
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet', // Ví dụ thông tin hoạt động
              m_current: user.money - totalRevice, // Tiền trước khi thắng
              m_new: user.money, // Tiền sau khi thắng
              place: win.place,
              amount: win.amount,
              revice: win.revice,
              betId: betId,
            },
          });
        });
      }
    });

    // Note: Chờ tất cả cập nhật hoàn tất
    await Promise.all(updatePromises);

    return { userActives, clans, users_res };
  }

  // Note: Hàm phụ để gửi thông báo qua hệ thống
  async sendNotifications(old_game: any, s_res: string, users: any[]) {
    const split_res = s_res.split('_');
    const res_key = this.show_result_text(split_res[0]);

    // Note: Gửi thông báo kết quả chung cho tất cả người chơi
    await this.sendNotiSystem({
      content: `Máy chủ 24: Chúc mừng những người chơi đã chọn ${res_key}_${split_res[1]}`,
      server: old_game.server,
      uid: 'local',
    });

    // Note: Tạo và gửi thông báo cho người thắng lớn (nếu có)
    const notices = users
      .filter((w) => w.amount >= 5e8)
      .map(
        (w) =>
          `Chúc mừng người chơi ${w.name} đã thắng ${new Intl.NumberFormat('vi').format(w.revice)} vàng vào ${this.convert_key(w.place)}`,
      );
    if (notices.length > 0) {
      await this.sendNotiSystem({
        content: 'Xin chúc mừng những người chơi sau:\n' + notices.join('\n'),
        server: old_game.server,
        uid: 'local',
      });
      await this.sendBetWinDiscord(
        'Xin chúc mừng những người chơi sau:\n' + notices.join('\n'),
      );
    }
  }

  @OnEvent('mini.server.24.re', { async: true })
  async handleMiniServerRE(id: string) {
    try {
      const n_game = await this.miniGameModel.findById(id);
      this.socketGateway.server.emit('mini.bet', { n_game: n_game.toObject() });
    } catch (err: any) {
      this.logger.log(`Err Mini BET RE: Msg: ${err.message}`);
      this.socketGateway.server.emit('mini.bet', { err: err.message });
    }
  }

  //TODO ———————————————[Handler Mini Game 24]———————————————
  async handlerCreate(payload: CreateMiniGame) {
    try {
      const mini_g = await this.miniGameModel.create(payload);
      const res = this.generateResult();
      await this.resultMiniGameModel.create({
        miniId: mini_g.id,
        result: `${res}`,
      });
      this.logger.log(`Create BET 24: bet_id:${mini_g.id} - Res: ${res}`);
      await this.sendLogsServerDiscord(
        `Tạo phiên BET mới sv: 24 
        \n- BetId:${mini_g.id} 
        \n- Kết quả: ${res} 
        \n- Thời gian kết thúc: ${payload.timeEnd.toLocaleString()}`,
      );
      return mini_g;
    } catch (err: any) {
      this.logger.log(`Err Create BET 24: Msg: ${err.message}`);
      return;
    }
  }

  showResult(res: string) {
    let new_result = parseInt(res, 10);
    let obj_result = {
      c: new_result % 2 === 0,
      l: new_result % 2 !== 0,
      x: new_result < 50,
      t: new_result > 49,
      total: {
        CL: '',
        TX: '',
        result: `${new_result}`,
        XIEN: '',
      },
    };
    obj_result.total.CL = `${obj_result.c ? 'C' : 'L'}`;
    obj_result.total.TX = `${obj_result.t ? 'T' : 'X'}`;
    obj_result.total.XIEN = `${obj_result.total.CL}${obj_result.total.TX}`;
    return `${obj_result.total.XIEN}_${new_result}`;
  }

  generateResult() {
    return Math.floor(Math.random() * (98 - 0 + 1)) + 0; // 0 -> 98
  }

  addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
  }

  async sendNotiSystem(payload: {
    content: string;
    uid: 'local';
    server: string;
  }) {
    const msg = await this.messageModel.create(payload);
    this.socketGateway.server.emit('message-re', msg);
  }

  //TODO ———————————————[Jackpot Sv 24]———————————————
  // Note: Hàm xử lý trao thưởng jackpot cho người thắng trong phiên mini game
  async sendJackpot(payload: { server: string; betId: string }): Promise<void> {
    try {
      const { server, betId } = payload;

      // Note: Tải dữ liệu cần thiết song song để giảm thời gian chờ
      const [e_bet, jackpot, userBets] = await Promise.all([
        this.eConfigModel.findOne({ name: 'e_bet' }), // Note: Lấy cấu hình tỷ lệ cược
        this.JackpotModel.findOne({ server }), // Note: Lấy thông tin jackpot của server
        this.userBetModel.find({ betId, status: 2, isEnd: true, server: '24' }), // Note: Lấy các cược đã kết thúc và thắng
      ]);

      if (!jackpot)
        throw new Error(`Jackpot không tồn tại cho server: ${server}`);
      if (!e_bet) throw new Error('Cấu hình e_bet không tồn tại');

      // Note: Lọc người thắng (có revice > 0) và tính tổng số tiền cược của họ
      const user_bet_winners = userBets.filter((u) => u.revice > 0);
      const total_bet_winners = user_bet_winners.reduce(
        (sum, b) => sum + (b.amount ?? 0),
        0,
      );

      if (user_bet_winners.length === 0) {
        this.logger.log(`Không có người thắng jackpot cho betId: ${betId}`);
        return; // Note: Thoát nếu không có người thắng
      }

      // Note: Tính tổng giải thưởng jackpot dựa trên cấu hình
      const jackpotPrize = jackpot.score * (e_bet.option.jackpot ?? 0.05);

      // Note: Gộp tiền cược của cùng một user bằng Map để xử lý trường hợp thắng nhiều lần
      const winnersByUser = new Map<
        string,
        { score: number; precent?: number }
      >();
      user_bet_winners.forEach((user) => {
        const existing = winnersByUser.get(user.uid);
        if (existing) {
          existing.score += user.amount;
        } else {
          winnersByUser.set(user.uid, { score: user.amount });
        }
      });

      // Note: Tính tỷ lệ phần trăm đóng góp của từng user so với tổng cược
      winnersByUser.forEach((winner) => {
        winner.precent = winner.score / total_bet_winners; // Note: Tỷ lệ = tiền cược cá nhân / tổng cược
      });

      // Note: Lấy thông tin user và chuẩn bị bulk update
      const list_user = await this.userModel.find({
        _id: { $in: Array.from(winnersByUser.keys()) },
      });
      const userBulkOps: any[] = [];
      const activeBulkOps: any[] = [];
      const res_u_s: { _id: string; money: number; meta: any }[] = [];
      const list_notice_u: string[] = [];

      list_user.forEach((user) => {
        const winner = winnersByUser.get(user.id);
        if (winner) {
          const prize = (winner.precent || 0) * jackpotPrize; // Note: Tiền thưởng = tỷ lệ x tổng giải

          // Note: Chuẩn bị bulkWrite để cộng tiền thưởng vào tiền user
          userBulkOps.push({
            updateOne: {
              filter: { _id: user.id },
              update: { $inc: { money: prize } },
            },
          });

          // Note: Chuẩn bị dữ liệu trả về
          res_u_s.push({
            _id: user.id,
            money: user.money + prize,
            meta: user.meta,
          });

          // Note: Ghi hoạt động thắng jackpot
          activeBulkOps.push({
            insertOne: {
              document: {
                uid: user.id,
                active: {
                  name: 'win_jackpot',
                  m_current: user.money, // Note: Tiền trước khi nhận thưởng
                  m_new: user.money + prize, // Note: Tiền sau khi nhận thưởng
                  betId,
                  prize,
                },
              },
            },
          });

          // Note: Tạo thông báo cho từng người thắng
          list_notice_u.push(
            `Người chơi ${user.name} đã trúng Jackpot ${new Intl.NumberFormat('vi').format(prize)} vàng`,
          );
        }
      });

      // Note: Thực hiện tất cả cập nhật database song song
      const [user_bulk_result, active_bulk_result] = await Promise.all([
        userBulkOps.length
          ? this.userModel.bulkWrite(userBulkOps)
          : Promise.resolve(null), // Note: Cập nhật user
        activeBulkOps.length
          ? this.userActiveModel.bulkWrite(activeBulkOps)
          : Promise.resolve(null), // Note: Lưu activity
      ]);

      // Note: Gửi thông báo hệ thống nếu có người thắng
      if (list_notice_u.length > 0) {
        await this.sendNotiSystem({
          content:
            'Xin chúc mừng những người chơi sau:\n' + list_notice_u.join('\n'),
          server: 'all', // Note: Gửi thông báo tới tất cả server
          uid: 'local',
        });
      }

      // Note: Phát sự kiện cập nhật user hàng loạt
      if (user_bulk_result) {
        this.socketGateway.server.emit('user.update.bulk', res_u_s);
      }

      // Note: Cập nhật jackpot sau khi trao thưởng
      jackpot.score -= jackpotPrize;
      await jackpot.save();

      // Note: Phát sự kiện cập nhật jackpot cho client
      this.socketGateway.server.emit('jackpot.update', jackpot.toObject());

      this.logger.log(
        `Send Jackpot prizes completed for betId: ${betId} - Prize: ${jackpotPrize}`,
      );
    } catch (err: any) {
      // Note: Ghi log lỗi chi tiết để debug
      this.logger.log(
        `Err Jackpot - BetId: ${payload.betId} - Server: ${payload.server} - Msg: ${err.message}`,
      );
      throw err; // Note: Ném lỗi để caller xử lý nếu cần
    }
  }

  //TODO ———————————————[Handler notice info]———————————————

  // Note: Trích xuất số từ chuỗi đầu vào, loại bỏ ký tự đặc biệt
  extractValues(input: string): {
    result: string | null;
    values: string[];
    seconds: number | null;
  } {
    // Note: Loại bỏ ký tự không cần thiết, chỉ giữ chữ, số, khoảng trắng và dấu chấm
    const cleanedInput = input.replace(/[^\w\s.]/g, ' ').trim();

    // Note: Tách chuỗi thành mảng các từ
    const words = cleanedInput.split(/\s+/);

    // Note: Lọc các từ là số có định dạng hợp lệ (VD: 123, 1.234.567)
    const numbers = words
      .filter((word) => /^\d{1,3}(\.\d{3})*$/.test(word))
      .filter((n) => n !== '90.000.000'); // Note: Loại bỏ số không liên quan

    // Note: Xử lý mảng số để lấy result, values, seconds
    return this.processNumbers(numbers);
  }

  // Note: Xử lý mảng số để phân loại kết quả, giá trị lịch sử, và thời gian còn lại
  processNumbers(numbers: string[]): {
    result: string | null;
    values: string[];
    seconds: number | null;
  } {
    let result: string | null = null;
    let values: string[] = [];
    let seconds: number | null = null;

    if (numbers.length === 1) {
      // Note: Chỉ có 1 số -> coi đó là thời gian (seconds)
      seconds = parseInt(numbers[0], 10);
    } else if (numbers.length > 1) {
      // Note: Nhiều hơn 1 số: số cuối là seconds, số đầu là result, giữa là values
      seconds = parseInt(numbers[numbers.length - 1], 10);
      values = numbers.slice(1, numbers.length - 1).reverse(); // Note: Đảo ngược thứ tự values
      result = numbers[0];
    }

    return { result, values, seconds };
  }

  // Note: Hàm chính xử lý dữ liệu từ client và quản lý phiên mini game
  async miniGameClient(data: IData): Promise<void> {
    // Note: Kiểm tra đầu vào hợp lệ
    if (!data || !data.server || !data.content) {
      this.logger.error('Invalid data input');
      return;
    }

    const parameter = `${data.server}.mini.info`; // Note: Khóa mutex cho server cụ thể
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex()); // Note: Tạo mutex nếu chưa tồn tại
    }

    const mutex = this.mutexMap.get(parameter)!;
    const release = await mutex.acquire();
    try {
      // Note: Trích xuất thông tin từ content
      const parsedContent = this.extractValues(data.content);
      if (!parsedContent) {
        this.logger.error('Parsed content is null');
        return;
      }

      const { result, seconds, values } = parsedContent;
      const serverQuery = { server: data.server };

      // Note: Bỏ qua nếu không có result (phiên đầu tiên hoặc dữ liệu không đầy đủ)
      if (!result) {
        throw new Error(
          `Skip First BET - Server: ${data.server} - Result: ${result} - Values: ${values} - Time: ${seconds}`,
        );
      }

      // Note: Tìm phiên đang hoạt động gần nhất
      const latestSession = await this.miniGameModel
        .findOne({ ...serverQuery, isEnd: false })
        .sort({ updatedAt: -1 });

      if (latestSession) {
        await this.handleActiveSession(latestSession, values, seconds, data);
      } else {
        await this.handleNoActiveSession(
          serverQuery,
          result,
          values,
          seconds,
          data,
        );
      }
    } catch (err: any) {
      // Note: Ghi log lỗi chi tiết để debug
      this.logger.log(
        `Err MiniGameClient - Server: ${data.server} - Msg: ${err.message}`,
      );
      throw err; // Note: Ném lỗi để caller xử lý nếu cần
    } finally {
      // Note: Giải phóng mutex sau khi hoàn tất
      release();
    }
  }

  // Note: Xử lý phiên đang hoạt động
  async handleActiveSession(
    latestSession: any,
    values: string[],
    seconds: number,
    data: IData,
  ): Promise<void> {
    const now = moment().unix();
    const currentUpdate = moment(latestSession.updatedAt).unix();
    const timeEnd = moment(latestSession.timeEnd).unix();
    const lastResult = latestSession.lastResult.split('-');
    const isSession = values[0] === lastResult[0]; // Note: Kiểm tra phiên có trùng với kết quả trước không

    if (isSession) {
      if (timeEnd - now <= 0 || seconds === 0) {
        // Note: Đánh dấu phiên kết thúc nếu hết thời gian
        const updatedSession = await this.miniGameModel.findByIdAndUpdate(
          latestSession.id,
          { isEnd: true },
          { new: true, upsert: true },
        );
        this.socketGateway.server.emit('mini.bet', {
          n_game: updatedSession.toObject(),
        });
        await this.sendLogsServerDiscord(
          `Kết thúc phiên Bet sv: ${updatedSession.server} 
          \n- Kết quả cuối: ${updatedSession.lastResult} 
          \n- Thời gian kết thúc: ${new Date(`${updatedSession.timeEnd}`).toLocaleString()}`,
        );
      } else {
        // Note: Ngăn spam: kiểm tra khoảng cách thời gian cập nhật
        if (now - currentUpdate < 10) {
          throw new Error(
            `SPAM BET: Server: ${data.server} - Values: (${values}) - Time: <${seconds}>`,
          );
        }
        // Note: Cập nhật phiên hiện tại với thông tin mới
        const updatedSession = await this.miniGameModel.findByIdAndUpdate(
          latestSession.id,
          {
            result: '',
            lastResult: values.join('-'),
            timeEnd: this.addSeconds(new Date(), seconds),
          },
          { new: true, upsert: true },
        );
        this.socketGateway.server.emit('mini.bet', {
          n_game: updatedSession.toObject(),
        });
      }
    } else {
      // Note: Phiên không khớp -> hoàn tiền và tạo phiên mới
      const refundSession = await this.miniGameModel.findByIdAndUpdate(
        latestSession.id,
        { isEnd: true, result: 'refund' },
        { new: true, upsert: true },
      );
      this.socketGateway.server.emit('mini.bet', {
        n_game: refundSession.toObject(),
      });

      // Note: Thực hiện refund song song
      await Promise.all([
        this.cancelBetMinigame({
          betId: latestSession.id,
          server: latestSession.server,
        }),
        this.CreateNewMiniGame({
          server: data.server,
          uuid: data.uuid,
          lastResult: values.join('-'),
          timeEnd: this.addSeconds(new Date(), seconds),
        }),
        this.sendLogsServerDiscord(
          `Refund phiên bet sv: ${latestSession.server} 
          \n- BetId: ${latestSession.id} 
          \n- Kết quả trước: ${latestSession.lastResult} 
          \n- kết quả: refund
          \n- Thời gian kết thúc: ${new Date(`${latestSession.timeEnd}`).toLocaleString()}`,
        ),
      ]);

      throw new Error(
        `BET is not the current session: Server: ${data.server} - Values: (${values}) - Time: <${seconds}>`,
      );
    }
  }

  // Note: Xử lý khi không có phiên hoạt động
  async handleNoActiveSession(
    serverQuery: any,
    result: string,
    values: string[],
    seconds: number,
    data: IData,
  ): Promise<void> {
    const oldSession = await this.miniGameModel
      .findOne({ ...serverQuery, isEnd: true })
      .sort({ updatedAt: -1 });

    if (oldSession) {
      if (seconds === 0) {
        throw new Error(
          `BET till show result Server: ${data.server} - Values: (${values}) - Time: <${seconds}>`,
        );
      }

      const lastResult = oldSession.lastResult.split('-');
      const isNextSession = seconds <= 280 && values[1] === lastResult[0]; // Note: Kiểm tra xem có phải phiên tiếp theo không

      if (isNextSession) {
        // Note: Cập nhật kết quả cho phiên cũ và trao thưởng
        oldSession.result = result;
        await Promise.all([
          oldSession.save(),
          this.givePrizesToWinerMiniGameClient({
            betId: oldSession.id,
            result: result,
            server: data.server,
          }),
          this.CreateNewMiniGame({
            server: data.server,
            uuid: data.uuid,
            lastResult: values.join('-'),
            timeEnd: this.addSeconds(new Date(), seconds),
          }),
          this.sendLogsServerDiscord(
            `Trao thưởng phiên bet sv: ${oldSession.server} 
            \n- BetId: ${oldSession.id} 
            \n- Kết quả trước: ${oldSession.lastResult} 
            \n- kết quả: ${result} 
            \n- Thời gian kết thúc: ${new Date(`${oldSession.timeEnd}`).toLocaleString()}`,
          ),
        ]);
      } else {
        const isMissSession = seconds <= 280;
        if (isMissSession) {
          // Note: Refund phiên bị miss và tạo phiên mới
          oldSession.result = 'refund';
          await Promise.all([
            oldSession.save(),
            this.cancelBetMinigame({
              betId: oldSession.id,
              server: oldSession.server,
            }),
            this.CreateNewMiniGame({
              server: data.server,
              uuid: data.uuid,
              lastResult: values.join('-'),
              timeEnd: this.addSeconds(new Date(), seconds),
            }),
            this.sendLogsServerDiscord(
              `Refund phiên bet sv: ${oldSession.server} 
              \n- BetId: ${oldSession.id} 
              \n- Kết quả trước: ${oldSession.lastResult} 
              \n- kết quả: refund
              \n- Thời gian kết thúc: ${new Date(`${oldSession.timeEnd}`).toLocaleString()}`,
            ),
          ]);
        } else {
          throw new Error(
            `BET Delay: Server: ${data.server} - Values: (${values}) - Time: <${seconds}>`,
          );
        }
      }
    } else {
      // Note: Không có phiên cũ -> tạo phiên mới
      await this.CreateNewMiniGame({
        server: data.server,
        uuid: data.uuid,
        lastResult: values.join('-'),
        timeEnd: this.addSeconds(new Date(), seconds),
      });
    }
  }

  // Note: Hàm xử lý trao thưởng cho người thắng trong mini game, tận dụng các hàm phụ để tối ưu
  async givePrizesToWinerMiniGameClient(payload: {
    betId: string;
    result: string;
    server: string;
  }): Promise<void> {
    try {
      const { betId, result } = payload;

      // Note: Tải dữ liệu cần thiết song song để giảm thời gian chờ
      const [old_game, e_bet] = await Promise.all([
        this.miniGameModel.findById(betId), // Note: Lấy thông tin phiên game
        this.eConfigModel.findOne({ name: 'e_bet' }), // Note: Lấy cấu hình tỷ lệ cược
      ]);

      if (!old_game) throw new Error(`Game not found for betId: ${betId}`);

      const s_res = this.showResult(result); // Note: Chuyển đổi kết quả thành định dạng hiển thị
      const { cl = 1.95, x = 3.2, g = 70 } = e_bet?.option || {}; // Note: Mặc định tỷ lệ nếu không có config

      // Note: Lấy tất cả cược chưa kết thúc và xử lý người thắng bằng hàm phụ
      const users_bet = await this.userBetModel.find({ betId, isEnd: false });
      const { userBets, users } = await this.updateUserBets(
        users_bet,
        { result },
        cl,
        x,
        g,
        s_res,
      );

      // Note: Cập nhật thông tin user, clan và activity bằng hàm phụ
      const list_user = await this.userModel.find({
        _id: { $in: users.map((u) => u.uid) },
      });
      const { userActives, clans, users_res } = await this.updateUsersAndClans(
        users,
        list_user,
        old_game.id,
      );

      // Note: Cập nhật điểm clan bằng bulkWrite để tối ưu hiệu suất
      const bulkOpsClan = clans.map((clan) => ({
        updateOne: {
          filter: { _id: clan.clanId },
          update: { $inc: { score: clan.score } },
        },
      }));

      // Note: Chuẩn bị dữ liệu để trả về client
      const res_clans = clans.map((c) => {
        return {};
      });
      // Note: Thực hiện cập nhật clans và user activities song song, đảm bảo userActives luôn chạy kể cả khi không có clans
      const clans_bulk_promise = bulkOpsClan.length
        ? this.clanModel.bulkWrite(bulkOpsClan) // Note: Chỉ cập nhật clan nếu có dữ liệu
        : Promise.resolve(null); // Note: Trả về null nếu không có clan để cập nhật

      const active_promise = userActives.length
        ? this.userActiveModel.insertMany(userActives) // Note: Lưu tất cả activity nếu có
        : Promise.resolve([]); // Note: Trả về mảng rỗng nếu không có activity

      // Note: Chờ cả hai promise hoàn tất, nhưng không phụ thuộc lẫn nhau
      const [clans_bulk, active_result] = await Promise.all([
        clans_bulk_promise,
        active_promise,
      ]);

      // Note: Gửi thông báo hệ thống bằng hàm phụ
      await this.sendNotifications(old_game, s_res, users);

      // Note: Phát sự kiện socket với dữ liệu cập nhật
      const payload_socket = {
        n_game: old_game.toObject(),
        userBets,
        data_user: users_res,
      };
      this.socketGateway.server.emit('mini.bet', payload_socket);
      // Note: Clans hiện đang không kích hoạt trên FE
      // if (clans_bulk)
      //   this.socketGateway.server.emit('clan.update.bulk', clans_bulk);
    } catch (err: any) {
      // Note: Ghi log lỗi chi tiết để debug
      this.logger.log(
        `Err Give Prizes Winer MiniGame Client - BetId: ${payload.betId} - Msg: ${err.message}`,
      );
      throw err; // Note: Ném lỗi để caller xử lý nếu cần
    }
  }

  // Note: Hàm xử lý hoàn tiền cho user khi phiên mini game bị miss
  async cancelBetMinigame(payload: {
    betId: string;
    server: string;
  }): Promise<void> {
    try {
      const { betId, server } = payload;

      // Note: Tải dữ liệu song song để tối ưu thời gian
      const [old_game, userBets] = await Promise.all([
        this.miniGameModel.findById(betId), // Note: Lấy thông tin phiên game
        this.userBetModel.find({ betId, isEnd: false, server }), // Note: Lấy cược chưa kết thúc
      ]);

      if (!old_game || userBets.length === 0) {
        this.logger.log(`No game or bets found for betId: ${betId}`);
        return; // Note: Thoát nếu không có dữ liệu cần xử lý
      }

      // Note: Cập nhật tất cả cược thành trạng thái refund bằng updateMany để tối ưu
      await this.userBetModel.updateMany(
        { betId, isEnd: false },
        { status: 1, isEnd: true, result: 'refund' }, // Note: Status 1 = đã hoàn tiền
      );

      // Note: Chuẩn bị dữ liệu hoàn tiền cho user và activity
      const refundsByUser = new Map<
        string,
        {
          refund: number;
          bets: { userBetId: string; place: string; amount: number }[];
        }
      >();
      const update_userbets = userBets.map((ubet) => {
        const { uid, amount, id, place } = ubet;
        if (refundsByUser.has(uid)) {
          const existing = refundsByUser.get(uid)!;
          existing.refund += amount;
          existing.bets.push({ userBetId: id, place, amount });
        } else {
          refundsByUser.set(uid, {
            refund: amount,
            bets: [{ userBetId: id, place, amount }],
          });
        }
        return { ...ubet.toObject(), isEnd: true, status: 1, result: 'refund' }; // Note: Chuẩn bị dữ liệu trả về
      });

      const list_user = await this.userModel.find({
        _id: { $in: Array.from(refundsByUser.keys()) },
      });
      const userBulkOps: any[] = [];
      const activeBulkOps: any[] = [];
      const update_user: any[] = [];

      // Note: Xử lý cập nhật user và activity
      list_user.forEach((user) => {
        const userRefunds = refundsByUser.get(user.id);
        if (userRefunds) {
          const { refund, bets } = userRefunds;

          // Note: Chuẩn bị bulkWrite để cập nhật tiền user
          userBulkOps.push({
            updateOne: {
              filter: { _id: user.id },
              update: { $inc: { money: refund } },
            },
          });

          // Note: Ghi lại hoạt động hoàn tiền cho từng cược
          bets.forEach((bet) => {
            activeBulkOps.push({
              insertOne: {
                document: {
                  uid: user.id,
                  active: {
                    name: 'cancel_bet',
                    userBetId: bet.userBetId,
                    m_current: user.money,
                    m_new: user.money + refund, // Note: Tổng tiền sau hoàn
                    betId,
                    amount: bet.amount,
                    place: bet.place,
                  },
                },
              },
            });
          });

          // Note: Chuẩn bị dữ liệu trả về, loại bỏ thông tin nhạy cảm
          const { pwd_h, email, ...res } = user.toObject();
          res.money += refund;
          update_user.push(res);
        }
      });

      // Note: Thực hiện tất cả cập nhật database song song và phát sự kiện bulk update
      const user_bulk_promise = userBulkOps.length
        ? this.userModel.bulkWrite(userBulkOps) // Note: Cập nhật hàng loạt user nếu có dữ liệu
        : Promise.resolve(null); // Note: Trả về null nếu không có user để cập nhật

      const active_bulk_promise = activeBulkOps.length
        ? this.userActiveModel.bulkWrite(activeBulkOps) // Note: Lưu hàng loạt activity nếu có dữ liệu
        : Promise.resolve(null); // Note: Trả về null nếu không có activity để lưu

      // Note: Chờ cả hai bulk operation hoàn tất và lấy kết quả
      const [user_bulk_result, active_bulk_result] = await Promise.all([
        user_bulk_promise,
        active_bulk_promise,
      ]);

      // Note: Phát sự kiện socket với dữ liệu cập nhật chính
      const payload_socket = {
        n_game: old_game.toObject(),
        userBets: update_userbets,
        data_user: update_user,
      };
      this.socketGateway.server.emit('mini.bet', payload_socket);

      // Note: Phát sự kiện cập nhật user hàng loạt nếu có kết quả bulkWrite
      if (user_bulk_result) {
        let res_u_s = update_user.map((up) => {
          let { _id, money, meta } = up;
          return { _id, money, meta };
        });
        this.socketGateway.server.emit('user.update.bulk', res_u_s);
      }
    } catch (err: any) {
      // Note: Ghi log lỗi chi tiết để debug
      this.logger.log(
        `Err Cancel MiniGame Client - BetId: ${payload.betId} - Msg: ${err.message}`,
      );
      throw err; // Note: Ném lỗi để caller xử lý nếu cần
    }
  }

  // Note: Hàm tạo phiên mini game mới
  async CreateNewMiniGame(payload: CreateMiniGame) {
    try {
      const newMiniGame = await this.miniGameModel.create(payload);
      this.socketGateway.server.emit('mini.bet', {
        n_game: newMiniGame.toObject(),
      });
      this.logger.log(
        `Create MiniGame Client: ${newMiniGame.id} - ${payload.server}`,
      );
      await this.sendLogsServerDiscord(
        `Tạo phiên Bet mới sv: ${newMiniGame.server} 
        \n- BetId: ${newMiniGame.id} 
        \n- Kết quả cuối: ${newMiniGame.lastResult} 
        \n- Thời gian kết thúc: ${new Date(`${newMiniGame.timeEnd}`).toLocaleString()}`,
      );
    } catch (err: any) {
      this.logger.log(
        `Err Create MiniGame Client: ${err.message} - ${payload.server}`,
      );
    }
  }

  convert_key(res: string) {
    if (res === 'C') {
      return 'Chẵn';
    }
    if (res === 'L') {
      return 'Lẻ';
    }
    if (res === 'T') {
      return 'Tài';
    }
    if (res === 'X') {
      return 'Xỉu';
    }
    if (res === 'CT') {
      return 'Chẵn Tài';
    }
    if (res === 'CX') {
      return 'Chẵn Xỉu';
    }
    if (res === 'LT') {
      return 'Lẻ Tài';
    }
    if (res === 'LX') {
      return 'Lẻ Xỉu';
    }
    return res;
  }

  async sendLogsServerDiscord(msg: string) {
    try {
      await this.httpService.axiosRef.post(process.env.LOGS_SV_STATUS_DS_WB, {
        content: '```\n' + `${msg}\n` + '```',
        avatar_url: 'https://www.nrogame.me/image/icon.png',
      });
      return true;
    } catch (err: any) {
      console.log(err);
      this.logger.log('Đã xảy ra lỗi với discord Logs Server Status');
      return true;
    }
  }

  async sendBetWinDiscord(msg: string) {
    try {
      await this.httpService.axiosRef.post(process.env.LOGS_BET_WIN_DS_WB, {
        content: '```\n' + `${msg}\n` + '```',
        avatar_url: 'https://www.nrogame.me/image/icon.png',
      });
      return true;
    } catch (err: any) {
      console.log(err);
      this.logger.log('Đã xảy ra lỗi với discord Logs Bet Win');
      return true;
    }
  }
}

interface CreateMiniGame {
  server: string;
  uuid: string;
  timeEnd: Date;
  lastResult?: string;
}
