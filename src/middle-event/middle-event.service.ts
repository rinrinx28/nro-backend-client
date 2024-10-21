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
import moment from 'moment';

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

  async show_result_text(res) {
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
        if (typeBet === 'cl') {
          let rate = cl;
          if (s_res.split('_')[0].includes(place)) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
              place: place,
              amount: amount,
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
              amount: amount,
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
              amount: amount,
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
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet',
              betId: old_game.id,
              m_current: user.money,
              m_new: user.money + revice,
              place: w.place,
              server: old_game.server,
            },
          });

          // Update revice and score user;
          user.money += revice;
          user.meta.totalTrade += revice;
          let { clanId = null } = user.meta;
          // Update score clan
          if (clanId) {
            user.meta.score += revice;
            let clan = clans.findIndex((c) => c.clanId === clanId);
            if (clan < 0) clans.push({ clanId, score: revice });
            clans[clan].score += revice;
          }
          user.markModified('meta');
          await user.save();
          let convert_key = this.convert_key(w.place);
          notices.push(
            `Chức mừng người chơi ${user.name} đã ${w.amount > 5e8 ? 'thắng lớn' : 'cược thắng'} ${new Intl.NumberFormat('vi').format(revice)} vàng vào ${convert_key}`,
          );
        }
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
        /Kết quả giải trước: (\d+)\b(.*?)\bTổng giải thưởng:.*?<(\d+)>\s*giây/;
      const match = content.match(regex);

      if (match) {
        const result = parseInt(match[1], 10);
        const numbers = match[2]
          .split(',')
          .map((num) => num.trim())
          .map((s) => s.split('\b').filter((f) => f.length > 0)[0])
          .reverse(); // Lấy dãy số sau ký tự \b
        const remainingTime = parseInt(match[3], 10);

        // Kết hợp mảng số thành chuỗi
        const numbersString = numbers.join('-');

        return { result, numbers: numbers, numbersString, remainingTime };
      }

      return null;
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

      if (parsedContent) {
        const { result, numbers, remainingTime } = parsedContent;

        // Lấy phiên mới nhất từ cơ sở dữ liệu dựa vào server và isEnd
        const latestSession = await this.miniGameModel
          .findOne({
            server: data.server,
            isEnd: false,
          })
          .sort({ updatedAt: -1 });

        if (latestSession) {
          // Kiểm tra nếu remainingTime là 0
          if (remainingTime === 0) {
            // Đánh dấu phiên hiện tại là đã kết thúc
            const updatedSession = await this.miniGameModel
              .findByIdAndUpdate(
                latestSession.id,
                {
                  isEnd: true,
                },
                { new: true, upsert: true },
              )
              .exec();
            // TODO Send Client
            this.socketGateway.server.emit('mini.info', {
              n_game: updatedSession.toObject(),
            });
            return;
          } else {
            // So sánh với phiên mới nhất
            if (remainingTime !== 0) {
              if (latestSession.lastResult.split('-')[0] === `${result}`) {
                // Check time is down;
                let current = moment(`${latestSession.timeEnd}`).unix();
                let new_time = moment().unix();
                let timeSecond_current = current - new_time;
                if (timeSecond_current < remainingTime) {
                  const update_mini =
                    await this.miniGameModel.findByIdAndUpdate(
                      latestSession.id,
                      {
                        timeEnd: this.addSeconds(new Date(), remainingTime),
                      },
                      { new: true, upsert: true },
                    );
                  this.socketGateway.server.emit('mini.bet', {
                    n_game: update_mini.toObject(),
                  });
                  return;
                }
                this.logger.log(
                  `Session updated: SID: ${latestSession.id} - LastResult: ${latestSession.lastResult} - RemainingTime: ${remainingTime}`,
                );
                return;
              }
              return;
            } else {
              this.logger.log(
                `Server: ${data.server} - Data is not valid, skipping...`,
              );
              return;
            }
          }
        } else {
          const oldSession = await this.miniGameModel
            .findOne({
              server: data.server,
              isEnd: true,
            })
            .sort({ updatedAt: -1 });
          if (oldSession) {
            // Kiểm tra nếu remainingTime là 0
            if (remainingTime === 0) {
              // Đánh dấu phiên hiện tại là đã kết thúc
              this.logger.log(
                `Valid data, continuing the session. ${remainingTime} - ${result} - ${numbers.join('-')}`,
              );
              return;
            } else {
              // Check is next game
              // this.logger.log(numbers, oldSession.lastResult.split('-'));
              if (numbers[1] === oldSession.lastResult.split('-')[0]) {
                // Let save update old data and Send Prizes
                oldSession.result = numbers[0];
                await oldSession.save();
                await this.givePrizesToWinerMiniGameClient({
                  betId: oldSession.id,
                  result: numbers[0],
                  server: data.server,
                });
                if (remainingTime === 280) {
                  // Let create new
                  await this.CreateNewMiniGame({
                    server: data.server,
                    uuid: data.uuid,
                    lastResult: numbers.join('-'),
                    timeEnd: this.addSeconds(new Date(), remainingTime),
                  });
                  return;
                }
                return;
              } else {
                if (remainingTime === 280) {
                  // Let create new
                  await this.CreateNewMiniGame({
                    server: data.server,
                    uuid: data.uuid,
                    lastResult: numbers.join('-'),
                    timeEnd: this.addSeconds(new Date(), remainingTime),
                  });
                  this.logger.log(
                    'Minigame Client: Data not match ... create new',
                  );
                }
              }
              return;
            }
          } else {
            if (remainingTime === 280) {
              // Let create new
              await this.CreateNewMiniGame({
                server: data.server,
                uuid: data.uuid,
                lastResult: numbers.join('-'),
                timeEnd: this.addSeconds(new Date(), remainingTime),
              });
              this.logger.log('Minigame Client: Data not match ... create new');
              return;
            }
          }
        }
      } else {
        this.logger.log('Failed to parse content:', data.content);
        return;
      }
      return;
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
        if (typeBet === 'cl') {
          let rate = cl;
          if (s_res.split('_')[0].includes(place)) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
              place: place,
              amount: amount,
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
              amount: amount,
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
              amount: amount,
            });
          }
        }
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
          userActives.push({
            uid: user.id,
            active: {
              name: 'winer_bet',
              betId: betId,
              m_current: user.money,
              m_new: user.money + revice,
              place: w.place,
              server: old_game.server,
            },
          });
          user.money += revice;
          user.meta.totalTrade += revice;
          let { clanId = null } = user.meta;
          // Update Clan
          if (clanId) {
            user.meta.score += revice;
            let clan = clans.findIndex((c) => c.clanId === clanId);
            if (clan < 0) clans.push({ clanId, score: revice });
            clans[clan].score += revice;
          }
          user.markModified('meta');
          await user.save();
          let convert_key = this.convert_key(w.place);
          notices.push(
            `Chức mừng người chơi ${user.name} đã ${w.amount > 5e8 ? 'thắng lớn' : 'cược thắng'} ${new Intl.NumberFormat('vi').format(revice)} vàng vào ${convert_key}`,
          );
        }
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
      await this.sendNotiSystem({
        content: `Máy chủ ${server}: Chúc mừng những người chơi đã chọn ${s_res}`,
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
    } catch (err: any) {
      this.logger.log('Err Create MiniGame Client: ', err.message);
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
