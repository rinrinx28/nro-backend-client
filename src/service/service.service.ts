import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Service } from './schema/service.schema';
import { Model } from 'mongoose';
import { User } from 'src/user/schema/user.schema';
import { UserActive } from 'src/user/schema/userActive.schema';
import { SocketGateway } from 'src/socket/socket.gateway';
import { EConfig } from 'src/middle-event/schema/config.schema';
import * as moment from 'moment';

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
      const { isEnable } = e_shop;
      if (!isEnable) throw new Error('Chức năng nạp/rút tạm đóng!');
      const { data, typeUpdate, id, realAmount } = payload;
      const target_s = await this.serviceModel.findById(id);
      if (!target_s) throw new Error('Không tìm thấy Giao Dịch');
      this.logger.log(`Update Service: ${id} - Status: ${typeUpdate}`);
      const { type, amount, uid } = target_s.toObject();

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
              revice: amount,
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
            revice: amount,
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
    const target_u = await this.userModel.findById(uid);
    let { pwd_h, ...user } = target_u.toObject();
    let { money } = user;

    if (typeUpdate === '1') {
      // Refund money to User;
      if (type === '0') {
        let refund_money_rgold = amount * 1e6 * 37;
        // Refund Money to user with rate 1e6*37
        let user_rgold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              money: +refund_money_rgold,
              'meta.limitTrade': +refund_money_rgold,
              'meta.trade': -refund_money_rgold,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );

        let { pwd_h, ...res_u } = user_rgold.toObject();

        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'w_rgold',
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
        let user_gold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              money: +amount,
              'meta.limitTrade': +amount,
              'meta.trade': -amount,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );
        let { pwd_h, ...res_u } = user_gold.toObject();

        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'w_gold',
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
            name: 'd_rgold',
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
            name: 'd_gold',
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
            name: 'w_s_rgold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        let user_rgold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              'meta.withdraw': +amount * 37e6,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );

        let { pwd_h, ...res_u } = user_rgold.toObject();
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      } else if (type === '1') {
        // save active
        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'w_s_gold',
            status: typeUpdate,
            m_current: money,
            m_new: money,
          },
        });
        let user_rgold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              'meta.withdraw': +amount,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );

        let { pwd_h, ...res_u } = user_rgold.toObject();
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        return;
      } else if (type === '2') {
        let deposit_rgold = amount * 1e6 * 37;
        let user_rgold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              money: +deposit_rgold,
              'meta.deposit': +deposit_rgold,
              'meta.totalScore': +deposit_rgold,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );

        let { pwd_h, ...res_u } = user_rgold.toObject();

        await this.addDiamon(uid, deposit_rgold);

        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'd_rgold',
            status: typeUpdate,
            m_current: res_u.money - deposit_rgold,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        await this.addVip(res_u._id.toString());
        return;
      } else {
        let user_gold = await this.userModel.findByIdAndUpdate(
          uid,
          {
            $inc: {
              money: +amount,
              'meta.deposit': +amount,
              'meta.totalScore': +amount,
            },
          },
          {
            new: true,
            upsert: true,
          },
        );
        let { pwd_h, ...res_u } = user_gold.toObject();
        await this.addDiamon(uid, amount);

        await this.userActiveModel.create({
          uid: uid,
          active: {
            name: 'd_gold',
            status: typeUpdate,
            m_current: res_u.money - amount,
            m_new: res_u.money,
          },
        });
        this.socketGateway.server.emit('user.update', {
          ...res_u,
        });
        await this.addVip(res_u._id.toString());
        return;
      }
    }
  }

  // Add VIP
  async addVip(userId: string) {
    try {
      const user = await this.userModel.findById(userId);
      const e_reward = await this.EConfigModel.findOne({ name: 'e_reward' });

      if (!user || !e_reward) {
        throw new Error('User or reward config not found');
      }

      const { vipLevels } = e_reward.option;
      const { totalScore, vip, vipStartDate } = user.meta;

      // Tìm tất cả các cấp VIP mà người dùng có thể đạt được
      const eligibleVipLevels = vipLevels.filter(
        (level) => totalScore >= level.requiredPoints,
      );

      // Nếu có cấp độ VIP nào phù hợp, lấy cấp độ cao nhất
      const nextVipLevel = eligibleVipLevels.length
        ? eligibleVipLevels[eligibleVipLevels.length - 1]
        : null;

      if (nextVipLevel) {
        const { level } = nextVipLevel;

        if (user.meta.vip !== level) {
          // Cập nhật cấp độ VIP mới
          user.meta.vip = level;

          // Nếu chưa có ngày bắt đầu VIP, thiết lập ngày hiện tại
          if (!vipStartDate) {
            user.meta.vipStartDate = new Date();
            user.meta.vipExpiryDate = moment(user.meta.vipStartDate)
              .add(30, 'days')
              .toDate(); // Đảm bảo .toDate() để lưu vào MongoDB
          }
          // Đánh dấu meta đã thay đổi
          user.markModified('meta');
          await user.save();

          // Update active
          await this.userActiveModel.create({
            uid: userId,
            active: {
              name: 'upgrade_vip',
              m_current: user.money,
              m_new: user.money,
              v_current: vip,
              v_new: nextVipLevel,
            },
          });
          // Emit cập nhật người dùng qua WebSocket
          const { pwd_h, ...res_u } = user.toObject(); // Loại bỏ thông tin nhạy cảm trước khi gửi
          this.socketGateway.server.emit('user.update', res_u);
        }
      }
    } catch (err: any) {
      this.logger.log(`Err Set VIP User: ${err.message}`);
    }
  }

  async addDiamon(userId: string, amount: number) {
    try {
      const e_reward = await this.EConfigModel.findOne({ name: 'e_reward' });
      const user = await this.userModel.findById(userId);

      if (!user || !e_reward) {
        throw new Error('User or reward config not found');
      }
      const { diamon } = e_reward.option;
      let v_diamon = amount / diamon;
      user.diamon += v_diamon;
      await user.save();
      const { pwd_h, ...res_u } = user.toObject();
      this.socketGateway.server.emit('user.update', res_u);
    } catch (err: any) {
      this.logger.log(`Err Add Diamon User: ${err.message}`);
    }
  }
}
