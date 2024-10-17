import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Service } from './schema/service.schema';
import { Model } from 'mongoose';
import { User } from 'src/user/schema/user.schema';
import { UserActive } from 'src/user/schema/userActive.schema';

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
      if (!service)
        throw new Error(
          'Bạn chưa tạo giao dịch, xin vui lòng tạo ở NROGAME.ME!',
        );
      if (service.isEnd)
        throw new Error(
          'Giao dịch đã hết hạn hoặc chưa tạo, xin vui lòng tạo mới ở NROGAME.ME!',
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
      const { data, typeUpdate, id, realAmount } = payload;
      const target_s = await this.serviceModel.findById(id);
      if (!target_s) throw new Error('Không tìm thấy Giao Dịch');
      this.logger.log(`Update Service: ${id} - Status: ${typeUpdate}`);
      const { type, amount, uid } = target_s.toObject();
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
          return 'ok';
        default:
          await this.serviceModel.findByIdAndUpdate(id, {
            ...data,
            $inc: {
              revice: ['0', '1'].includes(type)
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
          return 'ok';
      }
    } catch (err: any) {
      this.logger.log(
        `Update Service Err: ${payload.id} - Status: ${payload.typeUpdate} - Msg: ${err.message}`,
      );
      return 'ok';
    }
  }

  async updateUserWithType(payload: UpdateUserWithTypeService) {
    const { type, amount, uid, typeUpdate, realAmount } = payload;
    const { money } = await this.userModel.findById(uid);

    if (typeUpdate === '1') {
      // Refund money to User;
      switch (type) {
        // Rut Thoi Vang (rgold)
        case '0':
          let refund_money_rgold = amount * 1e6 * 37;
          // Refund Money to user with rate 1e6*37
          await this.userModel.findByIdAndUpdate(uid, {
            $inc: {
              money: +refund_money_rgold,
            },
          });

          // save active
          await this.userActiveModel.create({
            uid: uid,
            active: {
              name: 'service withdraw rgold',
              status: typeUpdate,
              m_current: money,
              m_new: money + refund_money_rgold,
            },
          });
          return;
        // Rut Vang (gold)
        case '1':
          // Refund Money to user with rate 1e6*37
          await this.userModel.findByIdAndUpdate(uid, {
            $inc: {
              money: +amount,
            },
          });

          // save active
          await this.userActiveModel.create({
            uid: uid,
            active: {
              name: 'service withdraw gold',
              status: typeUpdate,
              m_current: money,
              m_new: money + amount,
            },
          });
          return;
        // Nap thoi vang
        case '2':
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
        // Nap vang
        default:
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
      switch (type) {
        // Rut Thoi Vang (rgold)
        case '0':
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
        // Rut Vang (gold)
        case '1':
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
        // Nap thoi vang
        case '2':
          let deposit_rgold = realAmount.money_receive * 1e6 * 37;
          await this.userModel.findByIdAndUpdate(uid, {
            $inc: {
              money: +deposit_rgold,
            },
          });

          await this.userActiveModel.create({
            uid: uid,
            active: {
              name: 'service deposit rgold',
              status: typeUpdate,
              m_current: money,
              m_new: money + deposit_rgold,
            },
          });
          return;
        // Nap vang
        default:
          await this.userModel.findByIdAndUpdate(uid, {
            $inc: {
              money: +realAmount.money_receive,
            },
          });

          await this.userActiveModel.create({
            uid: uid,
            active: {
              name: 'service deposit gold',
              status: typeUpdate,
              m_current: money,
              m_new: money + realAmount.money_receive,
            },
          });
          return;
      }
    }
  }
}
