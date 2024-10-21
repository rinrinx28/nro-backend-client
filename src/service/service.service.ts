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
  realAmount?: Record<string, number>;
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
      this.logger.log(
        `Query Service ${playerName} - ${service.id} - amount:${service.amount} - Type: ${service.type}`,
      );
      return service.toObject();
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
      let revice = ['0', '1'].includes(type)
        ? (realAmount.money_trade ?? 0)
        : (realAmount.money_receive ?? 0);

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
          await this.serviceModel.findByIdAndUpdate(id, data, {
            new: true,
            upsert: true,
          });
          return;
        case '1':
          await this.serviceModel.findByIdAndUpdate(id, data, {
            new: true,
            upsert: true,
          });
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
          await this.serviceModel.findByIdAndUpdate(
            id,
            {
              ...data,
              revice: revice,
            },
            {
              new: true,
              upsert: true,
            },
          );
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
            revice: revice,
          };
          this.socketGateway.server.emit('service.update', service);
          return 'ok';
      }
    } catch (err: any) {
      this.logger.log(
        `Update Service Err: ${payload.id} - Status: ${payload.typeUpdate} - Msg: ${err.message}`,
      );
      return `ok`;
    }
  }

  async updateUserWithType(payload: UpdateUserWithTypeService) {
    const { type, amount, uid, typeUpdate, realAmount } = payload;
    const targetUser = await this.userModel.findById(uid);

    if (!targetUser) {
      throw new Error('User not found');
    }

    const { pwd_h, ...user } = targetUser.toObject();
    const { money, meta } = user;
    const revice = ['0', '1'].includes(type)
      ? (realAmount.money_trade ?? 0)
      : (realAmount.money_receive ?? 0);

    const updateUser = async (
      update: Record<string, any>,
      activeName: string,
      newAmount: number,
      currentAmount: number,
    ) => {
      const updatedUser = await this.userModel.findByIdAndUpdate(uid, update, {
        new: true,
        upsert: true,
      });
      const { pwd_h, ...resUser } = updatedUser.toObject();

      // Save user activity
      await this.userActiveModel.create({
        uid: uid,
        active: {
          name: activeName,
          status: typeUpdate,
          m_current: currentAmount,
          m_new: newAmount,
        },
      });

      this.socketGateway.server.emit('user.update', { ...resUser });
    };

    if (typeUpdate === '1') {
      // Refund money to User
      let update: Record<string, any>;

      if (type === '0') {
        const refund_money_rgold = amount * 1e6 * 37;
        update = {
          $inc: {
            money: +refund_money_rgold,
          },
          $set: {
            meta: {
              ...meta,
              limitTrade: meta.limitedTrade + refund_money_rgold,
              trade: meta.limitedTrade - refund_money_rgold,
            },
          },
        };
        await updateUser(
          update,
          'w_c_rgold',
          money - refund_money_rgold,
          money,
        );
        return;
      } else if (type === '1') {
        update = {
          $inc: {
            money: +amount,
          },
          $set: {
            meta: {
              ...meta,
              limitTrade: meta.limitedTrade + amount,
              trade: meta.limitedTrade - amount,
            },
          },
        };
        await updateUser(update, 'w_c_gold', money - amount, money);
        return;
      } else {
        const activeName = type === '2' ? 'd_s_rgold' : 'd_s_gold';
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: activeName,
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        return;
      }
    }

    if (typeUpdate === '2') {
      // Refund money to User
      let update: Record<string, any>; // Declare the update variable here
      let activeName = '';

      if (type === '0') {
        activeName = 'w_s_rgold';
      } else if (type === '1') {
        activeName = 'w_s_gold';
      } else {
        const isGoldType = type === '2';
        const depositAmount = isGoldType ? revice * 1e6 * 37 : revice;
        update = {
          $inc: {
            money: +depositAmount,
          },
          $set: {
            meta: {
              ...meta,
              deposit: meta.deposit + depositAmount,
              totalScore: meta.totalScore + depositAmount,
            },
          },
        };
        await updateUser(
          update,
          isGoldType ? 'd_s_rgold' : 'd_s_gold',
          money - depositAmount,
          money,
        );
        return;
      }

      await this.userActiveModel.create({
        uid: uid,
        active: {
          name: activeName,
          status: typeUpdate,
          m_current: money,
          m_new: money,
        },
      });
    }
  }
}
