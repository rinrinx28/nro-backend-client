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
    // if (payload.server === '6') {
    // }
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
          let new_res =
            `${parseInt(res.result, 10) > 9 ? res.result : `0${res.result}`}`[1];
          let isRes = parseInt(new_res, 10);
          if (isRes % 2 === 0 && place === 'C') {
            isWinner = true;
          }
          if (isRes % 2 !== 0 && place === 'L') {
            isWinner = true;
          }
          if (isRes <= 4 && place === 'X') {
            isWinner = true;
          }
          if (isRes >= 5 && place === 'T') {
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
    let result = `${parseInt(res, 10) > 9 ? parseInt(res, 10) : `0${parseInt(res, 10)}`}`;
    let new_result = `${result}`[1];
    let obj_result = {
      c: parseInt(new_result, 10) % 2 === 0,
      l: parseInt(new_result, 10) % 2 !== 0,
      x: parseInt(new_result, 10) < 5,
      t: parseInt(new_result, 10) > 4,
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
    return `${obj_result.total.XIEN}_${result}`;
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
      // Tìm dãy số liên tiếp theo định dạng "số,số,số,..."
      const numberPattern = /\d{2}(?:,\d{2})+/g;
      const secondsPattern = /<(\d+)> giây/g;

      const numbers = content.match(numberPattern);
      const seconds = content
        .match(secondsPattern)
        ?.map((s) => s.match(/\d+/)?.[0]);
      if (numbers && seconds) {
        // Trích xuất dãy số và giây
        return {
          numbers: numbers[0].split(',').reverse() || [],
          remainingTime: parseInt(seconds[0], 10) || 0,
        };
      }
      return null;
      // Sử dụng biểu thức chính quy để lấy kết quả giải trước, dãy số và thời gian còn lại
      // const regex =
      //   /Kết quả giải trước: (\d+)\b(.*?)\bTổng giải thưởng:.*?<(\d+)>\s*giây/;
      // const match = content.match(regex);
      // if (match) {
      //   const result = parseInt(match[1], 10);
      //   const numbers = match[2]
      //     .split(',')
      //     .map((num) => num.trim())
      //     .flatMap((s) => s.split('\b')) // Sử dụng flatMap thay vì map để tránh mảng lồng nhau
      //     .filter((f) => f && f.length > 0) // Loại bỏ các ký tự trống và undefined
      //     .reverse(); // Lấy dãy số sau ký tự \b

      //   const remainingTime = parseInt(match[3], 10);

      //   // Kết hợp mảng số thành chuỗi
      //   const numbersString = numbers.join('-');

      //   return { result, numbers, numbersString, remainingTime };
      // }

      // return null;
    } catch (err: any) {
      console.log(err);
    }
  }

  async miniGameClient(data: IData) {
    const parameter = `${data.server}.mini.info`; // Value will be lock

    // Create mutex if it not exist
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex());
    }

    const mutex = this.mutexMap.get(parameter);
    const release = await mutex.acquire();
    try {
      const parsedContent = this.parseContent(data.content);

      if (!parsedContent) {
        return;
      }

      const { numbers, remainingTime } = parsedContent;
      // console.log(numbers);

      const latestSession = await this.miniGameModel
        .findOne({ server: data.server, isEnd: false })
        .sort({ updatedAt: -1 });

      if (latestSession) {
        if (remainingTime === 0) {
          // Mark current session as ended
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
        }

        // Compare latest session result
        if (
          numbers[0] === latestSession.lastResult.split('-')[0] &&
          numbers[1] === latestSession.lastResult.split('-')[1]
        ) {
          const timeDiff =
            moment(`${latestSession.timeEnd}`).unix() - moment().unix();

          if (timeDiff - remainingTime === 10) {
            const updatedSession = await this.miniGameModel
              .findByIdAndUpdate(
                latestSession.id,
                { timeEnd: this.addSeconds(new Date(), remainingTime) },
                { new: true, upsert: true },
              )
              .exec();

            this.socketGateway.server.emit('mini.bet', {
              n_game: updatedSession.toObject(),
            });
            return;
          }

          // this.logger.log(
          //   `Session updated: SID: ${latestSession.id} - LastResult: ${latestSession.lastResult} - RemainingTime: ${remainingTime}`,
          // );
          return;
        }
      } else {
        // Handle old sessions
        const oldSession = await this.miniGameModel
          .findOne({ server: data.server, isEnd: true })
          .sort({ updatedAt: -1 });

        if (oldSession) {
          if (remainingTime === 0) {
            // this.logger.log(
            //   `Valid data, continuing the session. ${remainingTime} - ${result} - ${numbers.join('-')}`,
            // );
            return;
          }

          // Check is next Session
          oldSession.result = numbers[0];
          if (numbers[1] === oldSession.lastResult.split('-')[0]) {
            // Await to 280s
            if (remainingTime === 280) {
              // save result
              await oldSession.save();
              await this.givePrizesToWinerMiniGameClient({
                betId: oldSession.id,
                result: numbers[0],
                server: data.server,
              });
              await this.CreateNewMiniGame({
                server: data.server,
                uuid: data.uuid,
                lastResult: numbers.join('-'),
                timeEnd: this.addSeconds(new Date(), remainingTime),
              });
              return;
            }
          } else if (remainingTime === 280) {
            // save result
            await oldSession.save();
            await this.givePrizesToWinerMiniGameClient({
              betId: oldSession.id,
              result: numbers[0],
              server: data.server,
            });
            await this.CreateNewMiniGame({
              server: data.server,
              uuid: data.uuid,
              lastResult: numbers.join('-'),
              timeEnd: this.addSeconds(new Date(), remainingTime),
            });
            // this.logger.log('Minigame Client: Data not match ... create new');
          }
          return;
        } else {
          // Create new game
          await this.CreateNewMiniGame({
            server: data.server,
            uuid: data.uuid,
            lastResult: numbers.join('-'),
            timeEnd: this.addSeconds(new Date(), remainingTime),
          });
        }
      }
    } catch (err: any) {
      this.logger.log(err);
    } finally {
      release();
      // Giai phong map;
      this.mutexMap.delete(parameter);
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

      // Let list user join the BET;
      let users: {
        uid: string;
        revice: number;
        place: string;
        amount: number;
      }[] = [];
      let userBets = [];
      let users_bet = await this.userBetModel.find({
        betId: betId,
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
          let new_res =
            `${parseInt(result, 10) > 9 ? result : `0${result}`}`[1];
          let isRes = parseInt(new_res, 10);
          if (isRes % 2 === 0 && place === 'C') {
            isWinner = true;
          }
          if (isRes % 2 !== 0 && place === 'L') {
            isWinner = true;
          }
          if (isRes <= 4 && place === 'X') {
            isWinner = true;
          }
          if (isRes >= 5 && place === 'T') {
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
        user_bet.result = result;
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
