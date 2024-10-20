import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Service } from './schema/service.schema';
import { Model } from 'mongoose';
import { User } from 'src/user/schema/user.schema';
import { UserActive } from 'src/user/schema/userActive.schema';
import { SocketGateway } from 'src/socket/socket.gateway';
import { EConfig } from 'src/middle-event/schema/config.schema';

interface UpdateService {
  id: string;
  typeUpdate: '1' | '2' | '0';
  data: any;
  realAmount: Record<string, number>;
}

interface UpdateUserWithTypeService {
  type: '0' | '1' | '2' | '3';
  typeUpdate: '1' | '2' | '0';
  uid: string;
  amount: number;
  realAmount: Record<string, number>;
}

@Injectable()
export class ServiceService {
  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<Service>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(UserActive.name)
    private readonly userActiveModel: Model<UserActive>,
    @InjectModel(EConfig.name)
    private readonly EConfigModel: Model<EConfig>,
    private readonly socketGateway: SocketGateway,
  ) {}

  private logger: Logger = new Logger('Service');

  async getServiceWithPlayerName(playerName: string) {
    try {
      const service = await this.serviceModel
        .findOne({
          playerName: playerName,
          isEnd: false,
        })
        .sort({ updatedAt: -1 });
      if (!service) throw new Error('bạn chưa tạo giao dịch tại nrogam e.m e');
      if (service.isEnd)
        throw new Error(
          'giao dịch của bạn bị hủy, xin tạo lại tại nrogam e.m e',
        );
      this.logger.log(`Query Service ${playerName} - ${service.id}`);
      return service;
    } catch (err: any) {
      this.logger.log(`Query Service ${playerName} - ${err.message}`);
      return err.message;
    }
  }

  async updateService(payload: UpdateService) {
    try {
      const e_shop = await this.EConfigModel.findOne({ name: 'e_shop' });
      const {
        option: {
          min_gold = 50e6,
          min_rgold = 5,
          max_gold = 600e6,
          max_rgold = 40,
        },
        isEnable,
      } = e_shop;
      if (!isEnable) throw new Error('Chức năng nạp/rút tạm đóng!');
      const { data, typeUpdate, id, realAmount } = payload;
      const target_s = await this.serviceModel.findById(id);
      if (!target_s) throw new Error('Không tìm thấy Giao Dịch');
      this.logger.log(`Update Service: ${id} - Status: ${typeUpdate}`);
      const { type, amount, uid } = target_s.toObject();
      // Check min & max;
      if (['0', '2'].includes(type)) {
        if (amount < min_rgold)
          throw new Error(
            `Bạn không thể giao dịch thấp hơn ${min_rgold} thỏi vàng`,
          );
        if (amount > max_rgold)
          throw new Error(
            `Bạn không thể giao dịch cao hơn ${max_rgold} thỏi vàng`,
          );
      } else {
        if (amount < min_gold)
          throw new Error(
            `Bạn không thể giao dịch thấp hơn ${new Intl.NumberFormat('vi').format(min_gold)} vàng`,
          );
        if (amount > max_gold)
          throw new Error(
            `Bạn không thể giao dịch cao hơn ${new Intl.NumberFormat('vi').format(max_gold)} vàng`,
          );
      }
      let service = target_s.toObject();
      switch (typeUpdate) {
        case '0':
          await this.serviceModel.findByIdAndUpdate(id, data);
          return;
        case '1':
          await this.serviceModel.findByIdAndUpdate(id, data);
          await this.updateUserWithType({
            uid: uid.toString(),
            amount,
            type,
            typeUpdate,
            realAmount,
          });
          service = { ...service, ...data };
          this.socketGateway.server.emit('service.update', service);
          return 'ok';
        default:
          await this.serviceModel.findByIdAndUpdate(id, {
            ...data,
            $inc: {
              revice: ['2', '3'].includes(type)
                ? realAmount.money_trade
                : realAmount.money_receive,
            },
          });
          await this.updateUserWithType({
            uid: uid.toString(),
            amount,
            type,
            typeUpdate,
            realAmount,
          });
          service = {
            ...service,
            ...data,
            revice: ['2', '3'].includes(type)
              ? realAmount.money_trade
              : realAmount.money_receive,
          };
          this.socketGateway.server.emit('service.update', service);
          return 'ok';
      }
    } catch (err: any) {
      this.logger.log(
        `Update Service Err: ${payload.id} - Status: ${payload.typeUpdate} - Msg: ${err.message}`,
      );
      return `no|${err.message}`;
    }
  }

  async updateUserWithType(payload: UpdateUserWithTypeService) {
    const { type, amount, uid, typeUpdate, realAmount } = payload;
    const target_u = await this.userModel.findById(uid);
    let { pwd_h, ...user } = target_u.toObject();
    let { money } = user;

    if (typeUpdate === '1') {
      // Refund money to User;
      if (type === '0') {
        let refund_money_rgold = amount * 1e6 * 37;
        // Refund Money to user with rate 1e6*37
        let user_rgold = await this.userModel.findByIdAndUpdate(uid, {
          $inc: {
            money: +refund_money_rgold,
            'meta.limitTrade': +refund_money_rgold,
            'meta.trade': -refund_money_rgold,
          },
        });

        let { pwd_h, ...res_u } = user_rgold;

        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service withdraw rgold',
            status: typeUpdate,
            m_current: res_u.money - refund_money_rgold,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      } else if (type === '1') {
        // Refund Money to user with rate 1e6*37
        let user_gold = await this.userModel.findByIdAndUpdate(uid, {
          $inc: {
            money: +amount,
            'meta.limitTrade': +amount,
            'meta.trade': -amount,
          },
        });
        let { pwd_h, ...res_u } = user_gold;

        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service withdraw gold',
            status: typeUpdate,
            m_current: res_u.money - amount,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      } else if (type === '2') {
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service deposit rgold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        return;
      } else {
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service deposit gold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        return;
      }
    }

    if (typeUpdate === '2') {
      // Refund money to User;
      if (type === '0') {
        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service withdraw rgold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        return;
      } else if (type === '1') {
        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service withdraw gold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        return;
      } else if (type === '2') {
        let deposit_rgold = realAmount.money_receive * 1e6 * 37;
        let user_rgold = await this.userModel.findByIdAndUpdate(uid, {
          $inc: {
            money: +deposit_rgold,
            'meta.deposit': +deposit_rgold,
            'meta.totalScore': +deposit_rgold,
          },
        });

        let { pwd_h, ...res_u } = user_rgold;

        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service deposit rgold',
            status: typeUpdate,
            m_current: res_u.money - deposit_rgold,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      } else {
        let user_gold = await this.userModel.findByIdAndUpdate(uid, {
          $inc: {
            money: +realAmount.money_receive,
            'meta.deposit': +realAmount.money_receive,
            'meta.totalScore': +realAmount.money_receive,
          },
        });
        let { pwd_h, ...res_u } = user_gold;

        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'service deposit gold',
            status: typeUpdate,
            m_current: res_u.money - realAmount.money_receive,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      }
    }
  }
}
