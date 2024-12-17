import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Service } from './schema/service.schema';
import { Model } from 'mongoose';
import { User } from 'src/user/schema/user.schema';
import { UserActive } from 'src/user/schema/userActive.schema';
import { SocketGateway } from 'src/socket/socket.gateway';
import { EConfig } from 'src/middle-event/schema/config.schema';
import * as moment from 'moment';
import { Mutex } from 'async-mutex';

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
  private readonly mutexMap = new Map<string, Mutex>();

  async getServiceWithPlayerName(playerName: string) {
    const parameter = `${playerName}.getServiceWithPlayerName`; // Value will be lock

    // Create mutex if it not exist
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex());
    }

    const mutex = this.mutexMap.get(parameter);
    const release = await mutex.acquire();
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
    } finally {
      release();
    }
  }

  async updateService(payload: UpdateService) {
    const { id, typeUpdate, data, realAmount } = payload;
    const parameter = `${typeUpdate}.updateService`; // Khóa mutex theo loại cập nhật

    // Create mutex if it not exist
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex());
    }

    const mutex = this.mutexMap.get(parameter);
    const release = await mutex.acquire();
    try {
      // Kiểm tra trạng thái e_shop
      const eShopConfig = await this.EConfigModel.findOne({ name: 'e_shop' });
      if (!eShopConfig?.isEnable)
        throw new Error('Chức năng nạp/rút tạm đóng!');

      const target_s = await this.serviceModel.findById(id);
      if (!target_s) throw new Error('Không tìm thấy Giao Dịch');

      const { type, amount, uid } = target_s.toObject();
      this.logger.log(`Update Service: ${id} - Status: ${typeUpdate}`);

      // Hàm phụ cập nhật service trong MongoDB
      const updateServiceInDB = async (updateData: any) => {
        return this.serviceModel.findByIdAndUpdate(id, updateData, {
          new: true,
          upsert: true,
        });
      };

      // Hàm phụ emit socket
      const emitServiceUpdate = (updatedService: any) => {
        this.socketGateway.server.emit('service.update', updatedService);
      };

      let service = target_s.toObject();
      switch (typeUpdate) {
        case '0':
          await updateServiceInDB(data);
          return;
        case '1':
          this.socketGateway.server.emit('service.cancel', {
            serviceId: service._id,
            uid: uid,
          });
          return 'ok';
        default:
          const updateData =
            typeUpdate === '2' ? { ...data, revice: amount } : data;
          const updatedService = await updateServiceInDB(updateData);
          await this.updateUserWithType({
            uid: uid.toString(),
            amount,
            type,
            typeUpdate,
            realAmount,
          });
          emitServiceUpdate(updatedService);
          return 'ok';
      }
    } catch (err: any) {
      this.logger.log(
        `Update Service Err: ${payload.id} - Status: ${payload.typeUpdate} - Msg: ${err.message}`,
      );
      this.socketGateway.server.emit('service.cancel', id);
      return `ok`;
    } finally {
      release();
    }
  }

  async updateUserWithType(payload: UpdateUserWithTypeService) {
    const parameter = `${payload.uid}.updateUserWithType`; // Value will be lock

    // Create mutex if it not exist
    if (!this.mutexMap.has(parameter)) {
      this.mutexMap.set(parameter, new Mutex());
    }

    const mutex = this.mutexMap.get(parameter);
    const release = await mutex.acquire();
    try {
      const { type, amount, uid, typeUpdate, realAmount } = payload;
      const target_u = await this.userModel.findById(uid);
      let { pwd_h, ...user } = target_u.toObject();
      let { money } = user;

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
            name: 'd_s_rgold',
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
            name: 'd_s_gold',
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
    } catch (err: any) {
      return;
    } finally {
      release();
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

      // save active
      await this.userActiveModel.create({
        uid: user.id,
        active: {
          name: 'upgrade_diamon',
          d_current: user.diamon,
          d_new: user.diamon + v_diamon,
        },
      });
      user.diamon += v_diamon;
      await user.save();
      const { pwd_h, ...res_u } = user.toObject();
      this.socketGateway.server.emit('user.update', res_u);
    } catch (err: any) {
      this.logger.log(`Err Add Diamon User: ${err.message}`);
    }
  }
}
