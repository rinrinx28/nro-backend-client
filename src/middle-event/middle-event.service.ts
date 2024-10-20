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
import { Session } from './schema/ISession.schema';

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
    @InjectModel(Session.name)
    private readonly SessionModel: Model<Session>,
  ) {}
  private logger: Logger = new Logger('Middle Handler');

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
    await this.processData(payload);
  }

  @OnEvent('mini.bet.info', { async: true })
  async handlerMiniInfo(server: string) {
    try {
      const n_game = await this.miniGameModel
        .findOne({ server: server, isEnd: false })
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
        .findOne({ isEnd: false })
        .sort({ updatedAt: -1 });
      // Fisrt time run system or out range time end!
      if (!old_game) {
        let old_r_game = await this.miniGameModel
          .find({ server: '24' })
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
      let users: { uid: string; revice: number; place: string }[] = [];
      let userBets = [];
      let users_bet = await this.userBetModel.find({
        betId: old_game.id,
        isEnd: false,
      });
      let notices: string[] = [];
      // Find Winer and save user bet;
      for (const user_bet of users_bet) {
        const { place, typeBet, amount, uid } = user_bet;
        if (typeBet === 'cl') {
          let rate = cl;
          if (s_res.split('_')[0].includes(place)) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
              place: place,
            });
          }
        } else if (typeBet === 'x') {
          let rate = x;
          if (s_res.split('_')[0].includes(place)) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
              place: place,
            });
          }
        } else {
          let rate = g;
          if (s_res.split('_')[1] === place) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
              place: place,
            });
          }
        }
        user_bet.isEnd = true;
        user_bet.status = 2;
        user_bet.result = res.result;
        await user_bet.save();
        userBets.push(user_bet.toObject());
      }

      // Get user data of list winer;
      let users_res: { _id: string; money: number }[] = [];
      let userActives: { uid: string; active: Record<string, any> }[] = [];
      const list_user = await this.userModel.find({
        _id: {
          $in: users.map((u) => u.uid),
        },
      });
      for (const user of list_user) {
        const winner = users.filter((u) => u.uid === user.id);
        for (const w of winner) {
          const { revice } = w;
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet',
              betId: old_game.id,
              m_current: user.money,
              m_new: user.money + revice,
              place: w.place,
            },
          });
          user.money += revice;
          await user.save();
          notices.push(
            `Chức mừng người chơi ${user.name} đã cược thắng ${new Intl.NumberFormat('vi').format(revice)} vàng vào ${w.place}`,
          );
        }
        users_res.push({ _id: user.id, money: user.money });
      }

      // Save active
      await this.userActiveModel.insertMany(userActives);

      // Send notice result;
      await this.sendNotiSystem({
        content: `Máy chủ 24: Chúc mừng những người chơi đã chọn ${s_res}`,
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

      // Create new Bet 24
      const last_res = await this.miniGameModel
        .find({ server: '24' })
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
    let result = `${Number(res) > 9 ? res : `0${res}`}`;
    let new_result = `${result}`[1];
    let obj_result = {
      c: Number(new_result) % 2 === 0,
      l: Number(new_result) % 2 !== 0,
      x: Number(new_result) < 5,
      t: Number(new_result) > 4,
      total: {
        CL: '',
        TX: '',
        result: `${result}`,
        XIEN: '',
      },
    };
    obj_result.total.CL = `${obj_result.c ? 'C' : 'L'}`;
    obj_result.total.TX = `${obj_result.t ? 'T' : 'X'}`;
    obj_result.total.XIEN = `${obj_result.total.CL}${obj_result.total.TX}`;
    return `${obj_result.total.XIEN}_${res}`;
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

  //TODO ———————————————[Handler notice info]———————————————
  parseContent(content: string) {
    try {
      // Sử dụng biểu thức chính quy để lấy kết quả giải trước, dãy số và thời gian còn lại
      const regex =
        /Kết quả giải trước: (\d+).*?(\d+)\b(.*?)\bTổng giải thưởng:.*?<(\d+)>\s*giây/;
      const match = content.match(regex);

      if (match) {
        const result = parseInt(match[1], 10); // Kết quả giải trước
        const remainingTime = parseInt(match[4], 10); // Thời gian còn lại

        // Tách giá trị cuối cùng trước dấu \b
        const lastValueWithB = match[3]; // Giá trị trước dấu \b
        const lastValue_split = lastValueWithB.split('\b')[0].split(','); // Tách ra để lấy giá trị
        const lastValue = lastValue_split[lastValue_split.length - 1];
        return { result, numbers: [lastValue], remainingTime };
      }

      return null;
    } catch (err: any) {
      console.log(err);
    }
  }

  async processData(data: IData) {
    try {
      const parsedContent = this.parseContent(data.content);

      if (parsedContent) {
        const { result, numbers, remainingTime } = parsedContent;

        // Lấy phiên mới nhất từ cơ sở dữ liệu dựa vào server và isEnd
        const latestSession = await this.SessionModel.findOne({
          server: data.server,
        }).sort({ receivedAt: -1 });

        if (latestSession) {
          // Kiểm tra nếu remainingTime là 0
          if (remainingTime === 0) {
            // Đánh dấu phiên hiện tại là đã kết thúc
            const updatedSession = await this.SessionModel.findByIdAndUpdate(
              latestSession.id,
              {
                isEnd: true, // Đánh dấu phiên là đã kết thúc
                receivedAt: new Date(),
              },
              { new: true, upsert: true },
            ).exec();
            console.log('Session ended:', updatedSession);
          } else {
            // So sánh với phiên mới nhất
            if (
              latestSession.result === result ||
              latestSession.numbers.includes(latestSession.result.toString())
            ) {
              console.log('Valid data, continuing the session.');

              // Lưu phiên mới vào cơ sở dữ liệu
              const newSession = await this.SessionModel.findByIdAndUpdate(
                latestSession.id,
                {
                  content: data.content,
                  result,
                  numbers,
                  remainingTime,
                  receivedAt: new Date(),
                  isEnd: remainingTime === 0,
                },
                { new: true, upsert: true },
              ).exec();
              console.log('Session updated:', newSession);
            } else {
              console.log('Data is not valid, skipping...');
            }
          }
        } else {
          console.log('No previous session found, saving new session.');

          const newSession = await this.SessionModel.create({
            server: data.server,
            content: data.content,
            result,
            numbers,
            remainingTime,
            receivedAt: new Date(),
            isEnd: remainingTime === 0,
          });
          console.log('New session saved:', newSession);
        }
      } else {
        console.log('Failed to parse content:', data.content);
      }
    } catch (err: any) {
      console.log(err);
    }
  }
  // Hàm ghi log dữ liệu trễ
  async logDelayedData(data: IData) {
    // Thực hiện ghi log hoặc lưu trữ dữ liệu trễ
    console.log('Logging delayed data:', data.content);
    // Có thể tạo một mô hình mới để lưu trữ thông tin về dữ liệu trễ nếu cần
  }
}

interface CreateMiniGame {
  server: string;
  uuid: string;
  timeEnd: Date;
  lastResult?: string;
}
