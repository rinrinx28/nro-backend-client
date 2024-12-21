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
    await this.miniGameClient(payload);
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
      // let check old mini game;
      let old_game = await this.miniGameModel
        .findOne({ isEnd: false, server: '24' })
        .sort({ updatedAt: -1 });
      // Fisrt time run system or out range time end!
      if (!old_game) {
        let old_r_game = await this.resultMiniGameModel
          .find()
          .sort({ updatedAt: -1 })
          .limit(10);
        let n_game = await this.handlerCreate({
          server: '24',
          timeEnd: this.addSeconds(new Date(), 60),
          uuid: 'local',
          lastResult: old_r_game.map((r) => r.result).join('-'),
        });
        const payload = {
          n_game: n_game.toObject(),
        };
        this.socketGateway.server.emit('mini.bet', payload);
        return;
      }
      // If have old_game;
      const res = await this.resultMiniGameModel.findOne({
        miniId: old_game.id,
      });
      // save isEnd;
      old_game.isEnd = true;
      old_game.result = res.result;
      await old_game.save();
      const s_res = this.showResult(res.result);
      // Let send prizes to winers;
      const e_bet = await this.eConfigModel.findOne({ name: 'e_bet' });
      let { cl = 1.95, x = 3.2, g = 70 } = e_bet.option;

      // Let list user join the BET;
      let users: {
        uid: string;
        revice: number;
        place: string;
        amount: number;
      }[] = [];
      let userBets = [];
      let users_bet = await this.userBetModel.find({
        betId: old_game.id,
        isEnd: false,
      });
      let notices: string[] = [];
      // Find Winer and save user bet;
      for (const user_bet of users_bet) {
        const { place, typeBet, amount, uid } = user_bet;

        let rate;
        let isWinner = false;

        if (typeBet === 'cl') {
          rate = cl;
          let isRes = parseInt(res.result, 10);
          if (isRes % 2 === 0 && place === 'C') {
            isWinner = true;
          }
          if (isRes % 2 !== 0 && place === 'L') {
            isWinner = true;
          }
          if (isRes <= 49 && place === 'X') {
            isWinner = true;
          }
          if (isRes >= 50 && place === 'T') {
            isWinner = true;
          }
        } else if (typeBet === 'x') {
          rate = x;
          isWinner = s_res.split('_')[0] === place;
        } else {
          rate = g;
          isWinner = s_res.split('_')[1] === place;
        }

        if (isWinner) {
          user_bet.revice = amount * rate;
          users.push({
            uid,
            revice: user_bet.revice,
            place,
            amount,
          });
        }
        // Update the user_bet status and fields
        user_bet.isEnd = true;
        user_bet.status = 2;
        user_bet.result = res.result;
        await user_bet.save();
        userBets.push(user_bet.toObject());
      }

      // Get user data of list winer;
      let users_res: { _id: string; money: number }[] = [];
      let userActives: { uid: string; active: Record<string, any> }[] = [];
      let clans: { clanId: string; score: number }[] = [];
      const list_user = await this.userModel.find({
        _id: {
          $in: users.map((u) => u.uid),
        },
      });
      for (const user of list_user) {
        const winner = users.filter((u) => u.uid === user.id);
        for (const w of winner) {
          const { revice } = w;

          // Cập nhật thông tin active cho người chơi thắng cược
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet',
              betId: old_game.id,
              m_current: user.money,
              m_new: user.money + revice,
              place: w.place,
              server: old_game.server,
              amount: w.amount,
            },
          });

          // Cập nhật tiền và meta cho user
          user.money += revice;
          user.meta.totalTrade += revice; // Cập nhật tổng giao dịch
          user.meta.limitTrade += revice; // Cập nhật limitedTrade
          let { clanId = null } = user.meta; // Kiểm tra clanId từ meta

          // Cập nhật điểm cho clan nếu có clanId
          if (clanId) {
            user.meta.score += revice; // Cập nhật tổng điểm của user
            let clan = clans.findIndex((c) => c.clanId === clanId);
            if (clan < 0) {
              clans.push({ clanId, score: revice });
            } else {
              clans[clan].score += revice;
            }
          }

          // Đánh dấu trường meta đã thay đổi
          user.markModified('meta');

          // Lưu user vào database
          try {
            await user.save();
            console.log(`Cập nhật thành công cho user: ${user.id}`);
          } catch (err) {
            console.error(`Lỗi khi lưu user ${user.id}:`, err);
          }

          // Tạo thông báo cho người thắng cược
          let convert_key = this.convert_key(w.place);
          if (w.amount >= 5e8) {
            notices.push(
              `Chúc mừng người chơi ${user.name} đã thắng lớn ${new Intl.NumberFormat('vi').format(revice)} vàng vào ${convert_key}`,
            );
          }
        }

        // Đưa kết quả cuối cùng của người dùng vào users_res
        users_res.push({ _id: user.id, money: user.money });
      }

      // Save clan;
      const bulkOps_clan = clans.map((clan) => ({
        updateOne: {
          filter: { _id: clan.clanId }, // Filter by clanId
          update: { $inc: { score: +clan.score } }, // Update score
        },
      }));
      const clans_bulk = await this.clanModel.bulkWrite(bulkOps_clan);

      // Save active
      await this.userActiveModel.insertMany(userActives);

      // Send notice result;
      let split_res = s_res.split('_');
      let res_key = this.show_result_text(split_res[0]);
      await this.sendNotiSystem({
        content: `Máy chủ 24: Chúc mừng những người chơi đã chọn ${res_key}_${split_res[1]}`,
        server: old_game.server,
        uid: 'local',
      });

      // Send notice;
      if (notices.length > 0) {
        await this.sendNotiSystem({
          content: 'Xin chức mừng những người chơi sau:\n' + notices.join('\n'),
          server: old_game.server,
          uid: 'local',
        });
      }
      // Send jackpot:
      if (res.result === '99') {
        await this.sendJackpot({ server: '24', betId: old_game.id });
      }
      // Create new Bet 24
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
      const payload = {
        n_game: n_game.toObject(),
        userBets: userBets,
        data_user: users_res,
      };
      this.socketGateway.server.emit('mini.bet', payload);
      this.socketGateway.server.emit('clan.update.bulk', clans_bulk);
      return payload;
    } catch (err: any) {
      this.logger.log(`Err BET 24: Msg: ${err.message} - Main Func`);
      return err.message;
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
    return Math.floor(Math.random() * (98 - 0 + 1)) + 0;
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
  async sendJackpot(payload: { server: string; betId: string }) {
    try {
      const { server, betId } = payload;
      // Find jackpot;
      const e_bet = await this.eConfigModel.findOne({ name: 'e_bet' });
      const jackpot = await this.JackpotModel.findOne({ server });
      if (!jackpot) throw new Error('');

      // Find all userBet;
      const userBets = await this.userBetModel.find({
        betId: betId,
        status: 2,
        isEnd: true,
        server: '24',
      });

      // filter userbet is winer;
      const user_bet_winer = userBets.filter((u) => u.revice > 0);
      const total_bet_winer = userBets
        .filter((u) => u.revice > 0)
        .reduce((sum, b) => sum + (b.amount ?? 0), 0);

      // Config Jackpot;
      const prizes = jackpot.score * (e_bet.option.jackpot ?? 0.05);
      let store_user_winer: { uid: string; score: number; precent?: number }[] =
        [];
      for (const user of user_bet_winer) {
        let index = store_user_winer.findIndex((u) => u?.uid === user.uid);
        if (index < 0) {
          store_user_winer.push({
            uid: user.uid,
            score: user.amount,
          });
        } else {
          store_user_winer[index].score += user.amount;
        }
      }

      // Find percent of user;
      for (let i = 0; i < store_user_winer.length; i++) {
        let percent = total_bet_winer / store_user_winer[i].score;
        store_user_winer[i].precent = percent;
      }

      let list_u_up = store_user_winer.map((s) => {
        return this.userModel.findByIdAndUpdate(s.uid, {
          $inc: {
            money: +s.precent * prizes,
          },
        });
      });

      const updateUsers = await Promise.all(list_u_up);

      let list_u_active = updateUsers.map((up) => {
        let winer_u = store_user_winer.find((u) => u.uid === up.id);
        let m_current = up.money - winer_u.precent * prizes;
        let m_new = up.money;
        return this.userActiveModel.create({
          uid: up.id,
          active: {
            name: 'win_jackpot',
            m_current,
            m_new,
          },
        });
      });

      await Promise.all(list_u_active);

      let res_u_s = updateUsers.map((up) => {
        let { _id, money, meta } = up.toObject();
        return { _id, money, meta };
      });

      let list_notice_u = updateUsers.map((up) => {
        let winer_u = store_user_winer.find((u) => u.uid === up.id);
        let prize = winer_u.precent * prizes;
        return `Nguời chơi ${up.name} đã trúng Jackpot ${new Intl.NumberFormat('vi').format(prize)} vàng`;
      });

      if (list_notice_u.length > 0) {
        await this.sendNotiSystem({
          content:
            'Xin chúc mừng những người chơi sau:\n' + list_notice_u.join('\n'),
          server: 'all',
          uid: 'local',
        });
      }
      this.socketGateway.server.emit('user.update.bulk', res_u_s);

      // Save Jackpot;
      jackpot.score -= prizes;
      await jackpot.save();
      this.socketGateway.server.emit('jackpot.update', jackpot.toObject());
      this.logger.log('Send prizes Jackpot is Success!');
    } catch (err: any) {
      this.logger.log(`Err Jackpot: ${err.message}`);
    }
  }

  //TODO ———————————————[Handler notice info]———————————————
  extractValues(input: string) {
    // Loại bỏ các ký tự đặc biệt (bao gồm cả các ký tự điều khiển và ký tự không in được)
    const cleanedInput = input.replace(/[^\w\s.]/g, ' ').trim();

    // Tách chuỗi thành các từ dựa trên khoảng trắng
    const words = cleanedInput.split(/\s+/);

    // Mảng lưu trữ các số tìm được
    const numbers: string[] = [];

    // Duyệt qua các từ để tìm các số
    for (let word of words) {
      // Kiểm tra xem từ có phải là số có dấu chấm phân cách ngàn
      if (/^\d{1,3}(\.\d{3})*$/.test(word)) {
        numbers.push(word);
      }
    }

    let number_filter = numbers.filter((n) => n !== '90.000.000');
    let result = this.processNumbers(number_filter);

    return result;
  }

  processNumbers(numbers: string[]): {
    result: string | null;
    values: string[];
    seconds: number | null;
  } {
    let result: string | null = null;
    let values: string[] = [];
    let seconds: number | null = null;

    if (numbers.length === 1) {
      // Nếu mảng chỉ có 1 số, đó chính là "giây"
      seconds = parseInt(numbers[0], 10);
    } else if (numbers.length > 1) {
      // Nếu mảng có nhiều hơn 1 số
      seconds = parseInt(numbers[numbers.length - 1], 10); // Giá trị cuối cùng là "giây"

      // Đảo ngược các giá trị giữa đầu và cuối mảng
      values = numbers.slice(1, numbers.length - 1).reverse();

      // Lấy giá trị cuối cùng trong mảng đảo ngược làm "kết quả trước"
      result = numbers[0];
    }

    return { result, values, seconds };
  }

  async miniGameClient(data: IData) {
    if (!data || !data.server || !data.content) {
      this.logger.error('Invalid data input');
      return;
    }
    const parameter = `${data.server}.mini.info`; // Value will be lock

    // Create mutex if it not exist
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex());
    }

    const mutex = this.mutexMap.get(parameter);
    const release = await mutex.acquire();
    try {
      const parsedContent = this.extractValues(data.content);

      if (!parsedContent) {
        this.logger.error('Parsed content is null');
        return;
      }

      const { result, seconds, values } = parsedContent;
      const serverQuery = { server: data.server };

      // Bỏ qua result = null
      if (!result) {
        throw new Error(
          `Skip First BET - Server: ${data.server} - Result: ${result} - Values: ${values} - Time: ${seconds}`,
        );
      }

      // Tìm phiên đang hoạt động gần nhất
      const latestSession = await this.miniGameModel
        .findOne({ ...serverQuery, isEnd: false })
        .sort({ updatedAt: -1 });
      let isNextSession = false;

      if (latestSession) {
        let now = moment().unix();
        let current_update = moment(`${latestSession.updatedAt}`).unix();
        let timeEnd = moment(`${latestSession.timeEnd}`).unix();
        // Kiểm tra và cập nhật phiên hiện tại
        // Kiểm tra 1 kết quả gần nhất
        const lastResult = latestSession.lastResult.split('-');
        const isSession = values[0] === lastResult[0];
        if (isSession) {
          // Nếu thời gian còn lại là 0, đánh dấu phiên đã kết thúc
          if (timeEnd - now <= 0 || seconds === 0) {
            const updatedSession = await this.miniGameModel
              .findByIdAndUpdate(
                latestSession.id,
                { isEnd: true },
                { new: true, upsert: true },
              )
              .exec();
            this.socketGateway.server.emit('mini.bet', {
              n_game: updatedSession.toObject(),
            });
            return;
          } else {
            // Check update time
            if (now - current_update < 10) {
              throw new Error(
                `SPAM BET: Server: ${data.server} - Result: ${result} - Values: (${values}) - Time: <${seconds}>`,
              );
            }
            // Update phiên hiện tại
            const updatedSession = await this.miniGameModel
              .findByIdAndUpdate(
                latestSession.id,
                {
                  result: '',
                  lastResult: values.join('-'),
                },
                { new: true, upsert: true },
              )
              .exec();
            this.socketGateway.server.emit('mini.bet', {
              n_game: updatedSession.toObject(),
            });
            return;
          }
        } else {
          // save lại phiên cũ và trả kết quả là refund
          const updatedSession = await this.miniGameModel.findByIdAndUpdate(
            latestSession.id,
            { isEnd: true, result: 'refund' },
            { new: true, upsert: true },
          );
          this.socketGateway.server.emit('mini.bet', {
            n_game: updatedSession.toObject(),
          });
          // Tìm các phiên bị miss và refund tiền cho người chơi
          await this.cancelBetMinigame({
            betId: latestSession.id,
            server: latestSession.server,
          });
          // Tạo phiên mới
          await this.CreateNewMiniGame({
            server: data.server,
            uuid: data.uuid,
            lastResult: values.join('-'),
            timeEnd: this.addSeconds(new Date(), seconds),
          });
          throw new Error(
            `BET is not the current session: Server: ${data.server} - Result: ${result} - Values: (${values}) - Time: <${seconds}>`,
          );
        }
      } else {
        // Xử lý phiên cũ gần nhất nếu không có phiên hoạt động
        const oldSession = await this.miniGameModel
          .findOne({ ...serverQuery, isEnd: true })
          .sort({ updatedAt: -1 });

        if (oldSession) {
          if (seconds === 0)
            throw new Error(
              `BET till show result Server: ${data.server} - Result: ${result} - Values: (${values}) - Time: <${seconds}>`,
            );
          // Xử lý và tìm phiên chưa được xử lý kết quả
          // Kiểm tra và cập nhật phiên hiện tại
          // Kiểm tra 1 kết quả gần nhất
          const lastResult = oldSession.lastResult.split('-');
          isNextSession = seconds <= 280 && values[1] === lastResult[0];

          if (isNextSession) {
            // Lưu phiên cũ và tiến hành trả kết quả cho Clients
            oldSession.result = result;
            await oldSession.save();
            await this.givePrizesToWinerMiniGameClient({
              betId: oldSession.id,
              result: result,
              server: data.server,
            });

            // Tạo phiên mới
            await this.CreateNewMiniGame({
              server: data.server,
              uuid: data.uuid,
              lastResult: values.join('-'),
              timeEnd: this.addSeconds(new Date(), seconds),
            });
            return;
          } else {
            let isMissSession = seconds <= 280;
            if (isMissSession) {
              // Tìm các phiên bị miss và refund tiền cho người chơi
              await this.cancelBetMinigame({
                betId: oldSession.id,
                server: oldSession.server,
              });
              // save lại phiên cũ và trả kết quả là refund
              oldSession.result = 'refund';
              await oldSession.save();
              // Tạo phiên mới
              await this.CreateNewMiniGame({
                server: data.server,
                uuid: data.uuid,
                lastResult: values.join('-'),
                timeEnd: this.addSeconds(new Date(), seconds),
              });
              return;
            }
            throw new Error(
              `BET Delay: Server: ${data.server} - Result: ${result} - Values: (${values}) - Time: <${seconds}>`,
            );
          }
        } else {
          // Tạo phiên mới nếu không có phiên hoạt động và không có phiên cũ
          await this.CreateNewMiniGame({
            server: data.server,
            uuid: data.uuid,
            lastResult: values.join('-'),
            timeEnd: this.addSeconds(new Date(), seconds),
          });
          return;
        }
      }
    } catch (err: any) {
      this.logger.log(`Err: ${err.message}`);
    } finally {
      release();
    }
  }

  async givePrizesToWinerMiniGameClient(payload: {
    betId: string;
    result: string;
    server: string;
  }) {
    try {
      const { betId, result, server } = payload;
      const old_game = await this.miniGameModel.findById(betId);
      const s_res = this.showResult(result);
      // Let send prizes to winers;
      const e_bet = await this.eConfigModel.findOne({ name: 'e_bet' });
      let { cl = 1.95, x = 3.2, g = 70 } = e_bet.option;

      let users: {
        uid: string;
        revice: number;
        place: string;
        amount: number;
      }[] = [];
      let userBets = [];
      let notices: string[] = [];

      // Fetch user bets
      const users_bet = await this.userBetModel.find({
        betId,
        isEnd: false,
      });

      // Determine winners and update user bets
      const savePromises = users_bet.map(async (user_bet) => {
        const { place, typeBet, amount, uid } = user_bet;

        let rate: number;
        let isWinner = false;

        // Determine rate and winner status based on bet type
        if (typeBet === 'cl') {
          rate = cl;
          const isRes = parseInt(result, 10);
          isWinner =
            (isRes % 2 === 0 && place === 'C') ||
            (isRes % 2 !== 0 && place === 'L') ||
            (isRes <= 49 && place === 'X') ||
            (isRes >= 50 && place === 'T');
        } else if (typeBet === 'x') {
          rate = x;
          isWinner = s_res.split('_')[0] === place;
        } else {
          rate = g;
          isWinner = s_res.split('_')[1] === place;
        }

        // Handle winning bets
        if (isWinner) {
          const revice = amount * rate;
          users.push({ uid, revice, place, amount });
          user_bet.revice = revice;
        }

        // Update user bet fields
        user_bet.isEnd = true;
        user_bet.status = 2;
        user_bet.result = result;

        // Save changes
        await user_bet.save();
        userBets.push(user_bet.toObject());
      });

      // Wait for all updates to complete
      await Promise.all(savePromises);

      const users_res: { _id: string; money: number }[] = [];
      const userActives: { uid: string; active: Record<string, any> }[] = [];
      const clans: { clanId: string; score: number }[] = [];

      // Fetch user data
      const list_user = await this.userModel.find({
        _id: { $in: users.map((u) => u.uid) },
      });

      const saveUserPromises = list_user.map(async (user) => {
        const winnerData = users.filter((u) => u.uid === user.id);

        for (const winner of winnerData) {
          const { revice, place, amount } = winner;

          // Add active record for winner
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet',
              betId: old_game.id,
              m_current: user.money,
              m_new: user.money + revice,
              place,
              server: old_game.server,
              amount,
            },
          });

          // Update user's money and metadata
          user.money += revice;
          user.meta.totalTrade += revice;
          user.meta.limitTrade += revice;

          const { clanId = null } = user.meta;

          if (clanId) {
            // Update user's clan score
            user.meta.score += revice;
            const clanIndex = clans.findIndex((c) => c.clanId === clanId);

            if (clanIndex < 0) {
              clans.push({ clanId, score: revice });
            } else {
              clans[clanIndex].score += revice;
            }
          }

          // Mark `meta` as modified
          user.markModified('meta');

          // Create notification for the winner
          const convert_key = this.convert_key(place);
          if (amount >= 5e8) {
            notices.push(
              `Chúc mừng người chơi ${user.name} đã thắng lớn ${new Intl.NumberFormat('vi').format(revice)} vàng vào ${convert_key}`,
            );
          }
        }

        // Save the updated user
        try {
          await user.save();
          console.log(`Cập nhật thành công cho user: ${user.id}`);
        } catch (err) {
          console.error(`Lỗi khi lưu user ${user.id}:`, err);
        }

        // Add final result to `users_res`
        users_res.push({ _id: user.id, money: user.money });
      });

      // Wait for all user updates to complete
      await Promise.all(saveUserPromises);
      // Save clan;
      const bulkOps_clan = clans.map((clan) => ({
        updateOne: {
          filter: { _id: clan.clanId }, // Filter by clanId
          update: { $inc: { score: +clan.score } }, // Update score
        },
      }));
      const clans_bulk = await this.clanModel.bulkWrite(bulkOps_clan);

      // Save active
      await this.userActiveModel.insertMany(userActives);

      // Send notice result;
      let split_res = s_res.split('_');
      let res_key = this.show_result_text(split_res[0]);
      await this.sendNotiSystem({
        content: `Máy chủ ${server}: Chúc mừng những người chơi đã chọn ${res_key}_${split_res[1]}`,
        server: server,
        uid: 'local',
      });

      // Send notice;
      if (notices.length > 0) {
        await this.sendNotiSystem({
          content: 'Xin chức mừng những người chơi sau:\n' + notices.join('\n'),
          server: server,
          uid: 'local',
        });
      }

      const payload_socket = {
        n_game: old_game.toObject(),
        userBets: userBets,
        data_user: users_res,
      };
      this.socketGateway.server.emit('mini.bet', payload_socket);
      this.socketGateway.server.emit('clan.update.bulk', clans_bulk);
    } catch (err: any) {
      this.logger.log('Err Give Prizes Winer MiniGame Client: ', err.message);
    }
  }

  async cancelBetMinigame(payload: { betId: string; server: string }) {
    try {
      const { betId, server } = payload;

      // Fetch necessary data concurrently
      const [old_game, userBets] = await Promise.all([
        this.miniGameModel.findById(betId),
        this.userBetModel.find({ betId, isEnd: false, server }),
      ]);

      if (!old_game || userBets.length === 0) return;

      // Update user bets in the database
      await this.userBetModel.updateMany(
        { betId },
        { status: 1, isEnd: true, result: 'refund' },
      );

      // Group refunds by user
      const list_user = userBets.reduce(
        (acc, ubet) => {
          const existing = acc.find((u) => u.uid === ubet.uid);
          if (existing) {
            existing.refund += ubet.amount;
          } else {
            acc.push({
              uid: ubet.uid,
              refund: ubet.amount,
              userBetId: ubet.id,
              place: ubet.place,
            });
          }
          return acc;
        },
        [] as {
          uid: string;
          refund: number;
          userBetId: string;
          place: string;
        }[],
      );

      // Prepare updates for userBets
      const update_userbets = userBets.map((ubet) => ({
        ...ubet.toObject(),
        isEnd: true,
        status: 1,
        result: 'refund',
      }));

      // Fetch all affected users
      const users = await this.userModel.find({
        _id: { $in: list_user.map((u) => u.uid) },
      });

      // Prepare bulkWrite operations for users
      const userBulkOps = [];
      const activeBulkOps = [];
      const update_user = [];

      for (const user of users) {
        const target = list_user.find((u) => u.uid === user.id);
        if (target) {
          // Prepare user update operation
          userBulkOps.push({
            updateOne: {
              filter: { _id: user.id },
              update: { $inc: { money: target.refund } },
            },
          });

          // Prepare active record creation
          activeBulkOps.push({
            insertOne: {
              document: {
                uid: target.uid,
                active: {
                  name: 'cancel_bet',
                  userBetId: target.userBetId,
                  m_current: user.money,
                  m_new: user.money + target.refund,
                  betId: betId,
                  amount: target.refund,
                  place: target.place,
                },
              },
            },
          });

          // Exclude sensitive fields and prepare response
          const { pwd_h, email, ...res } = user.toObject();
          res.money += target.refund; // Update the new money in response
          update_user.push(res);
        }
      }

      // Execute bulkWrite operations
      await Promise.all([
        this.userModel.bulkWrite(userBulkOps),
        this.userActiveModel.bulkWrite(activeBulkOps),
      ]);

      // Emit socket event
      const payload_socket = {
        n_game: old_game.toObject(),
        userBets: update_userbets,
        data_user: update_user,
      };
      this.socketGateway.server.emit('mini.bet', payload_socket);
    } catch (err: any) {
      this.logger.log('Err Cancel MiniGame Client: ', err.message);
    }
  }

  async CreateNewMiniGame(payload: CreateMiniGame) {
    try {
      const newMiniGame = await this.miniGameModel.create(payload);
      this.socketGateway.server.emit('mini.bet', {
        n_game: newMiniGame.toObject(),
      });
      this.logger.log(
        `Create MiniGame Client: ${newMiniGame.id} - ${payload.server}`,
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
}

interface CreateMiniGame {
  server: string;
  uuid: string;
  timeEnd: Date;
  lastResult?: string;
}
