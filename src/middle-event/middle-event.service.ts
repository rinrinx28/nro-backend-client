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
    console.log(payload);
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
      let users: { uid: string; revice: number }[] = [];
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
            });
          }
        } else if (typeBet === 'x') {
          let rate = x;
          if (s_res.split('_')[0].includes(place)) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
            });
          }
        } else {
          let rate = g;
          if (s_res.split('_')[1] === place) {
            user_bet.revice = amount * rate;
            users.push({
              uid,
              revice: amount * rate,
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
        const { revice } = users.find((u) => u.uid === user.id);
        userActives.push({
          uid: user.id,
          active: {
            name: 'winer_bet',
            betId: old_game.id,
            m_current: user.money,
            m_new: user.money + revice,
          },
        });
        user.money += revice;
        await user.save();
        users_res.push({ _id: user.id, money: user.money });
        notices.push(
          `Chức mừng người chơi ${user.name} đã cược thắng ${new Intl.NumberFormat('vi').format(revice)} vàng`,
        );
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
        o_game: old_game.toObject(),
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
    let new_result = `${result}`.split('')[1];
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
}

interface CreateMiniGame {
  server: string;
  uuid: string;
  timeEnd: Date;
  lastResult?: string;
}
