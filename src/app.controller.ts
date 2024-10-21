import { Controller, Get, Param, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ServiceEvent,
  BotStatuEvent,
  NoticeInfoEvent,
  BotMoney,
} from './middle-event/dto/dto.event';
import { ServiceService } from './service/service.service';

@Controller('api')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly eventEmit: EventEmitter2,
    private service: ServiceService,
  ) {}

  // API 1: Nhân kết quả thông báo
  @Get('/client/:UUID/info')
  async statusNoticeBoss(
    @Param('UUID') uuid: string,
    @Query('text') text: string,
    @Query('server') server: string,
  ) {
    let payload: NoticeInfoEvent = {
      content: this.appService.hexToString(text),
      server: server,
      uuid: uuid,
    };
    this.eventEmit.emitAsync('notice.info', payload);
    return 'ok';
  }

  // API 2: Cập nhật thông tin Bot
  // /   + id: id của bot
  // /   + name: tên của bot (hexstring)
  // /   + map: tên map đứng treo (hexstring)
  // /   + zone: khu vực đứng treo
  // /   + type_money: loại tiền trong bot: 1 - vàng, 2 - thỏi vàng
  // /   + money: số vàng/thỏi vàng còn lại trong bot
  // / - web nhận được data -> trả về ok nếu không client sẽ call tiếp sau 5s
  @Get('/client/:UUID/bot')
  async updateInfoBot(
    @Param('UUID') uuid: string,
    @Query('id') id: string,
    @Query('name') name: string,
    @Query('map') map: string,
    @Query('zone') zone: string,
    @Query('type_money') type_money: string,
    @Query('money') money: string,
    @Query('server') server: string,
  ) {
    let payload: BotStatuEvent = {
      id: id,
      uuid: uuid,
      name: this.appService.hexToString(name),
      map: this.appService.hexToString(map),
      zone: zone,
      type_money: type_money as BotMoney,
      money: Number(money),
      server: server,
    };
    this.eventEmit.emitAsync('bot.status', payload);
    return 'ok';
  }

  // API 3: Kiểm tra đơn hàng nạp/rút
  @Get('/client/:UUID/service')
  async queryService(
    @Param('UUID') uuid: string,
    @Query('type') type: string,
    @Query('bot_id') bot_id: string,
    @Query('player_id') player_id: string,
    @Query('player_name') player_name: string,
    @Query('server') server: string,
    @Query('service_id') service_id: string,
    @Query('money_last') money_last: string,
    @Query('money_current') money_current: string,
    @Query('money_trade') money_trade: string,
    @Query('money_receive') money_receive: string,
  ) {
    switch (type) {
      case '0':
        // TODO Data Query: bot_id, player_id, player_name, server
        // /     + bot_id: id của bot
        // /     + player_id: id của người chơi
        // /     + player_name: tên của người chơi (hexstring)
        // / - web nhận được data -> trả về ok|player_id|service_id|type_service|quantity
        // /     + type_service = 0 - rút thỏi vàng, 1 - rút vàng, 2 - nạp thỏi vàng, 3 - nạp vàng
        // /     + player_id: cái này chỉ cần gửi lại để xác nhận tránh bug
        // /     + quantity: số vàng/thỏi vàng mà khách muốn nạp hoặc rút
        // / - nếu không có giao dịch nào -> web trả về no|content
        // /     + content là thông báo ví dụ như bạn không có giao dịch nào, hoặc bạn cần tạo giao dịch trên website xxx.xxx trước....
        // / - (*1) Lưu ý rằng: nếu 1 giao dịch cho timeout là 10 phút thì nếu quá 8 phút sẽ mặc định trả về no và sau 10 phút mới cho bấm hủy giao dịch (mặc định 2 phút ở giữa)
        // / nếu không xử lí như này thì người chơi sẽ giao dịch với bot và bấm trên web cùng lúc hủy -> gây bug
        // / - Mỗi user chỉ được 1 giao dịch, hoàn thành xong mới cho tạo tiếp
        const playerName = this.appService.hexToString(player_name);
        const service = await this.service.getServiceWithPlayerName(playerName);
        if (typeof service === 'string') return `no|${service}`;
        const { _id, type, amount } = service;
        await this.service.updateService({
          id: _id,
          typeUpdate: '0',
          data: {
            playerId: player_id,
            playerName: playerName,
            bot_id: bot_id,
          },
        });
        return `ok|${player_id}|${_id}|${type}|${amount}`;
      case '1':
        // TODO Data Query: bot_id, player_id, service_id, server
        // /     + bot_id: id của bot
        // /     + service_id: id của người chơi
        // /     + player_id: tên của người chơi
        // / - web nhận được data -> trả về ok
        // / - api này tạm thời chỉ để lưu log -> sau có thể check để cho vào danh sách đen, giao dịch trong game bị hủy nhưng giao dịch trên web vẫn để đó,
        // / không tự động xóa khi chưa vượt timeout để cho phép người chơi bấm hủy
        return this.service.updateService({
          id: service_id,
          typeUpdate: '1',
          data: {
            isEnd: true,
            status: '1',
          },
          realAmount: {
            money_trade: Number(money_trade ?? 0),
            money_receive: Number(money_receive ?? 0),
          },
        });
      case '2':
        // TODO Data Query: bot_id, player_id, service_id, money_last, money_current, money_trade, money_receive, server
        // / + money_last: vàng/thỏi vàng trước giao dịch của bot
        // / + money_current: vàng/thỏi vàng sau giao dịch của bot (vàng/thỏi vàng hiện tại)
        // / + money_trade: vàng/thỏi vàng mà bot giao dịch
        // / + money_receive: vàng/thỏi vàng mà người chơi giao dịch
        return this.service.updateService({
          id: service_id,
          typeUpdate: '2',
          data: {
            isEnd: true,
            status: '2',
          },
          realAmount: {
            money_trade: Number(money_trade ?? 0),
            money_receive: Number(money_receive ?? 0),
          },
        });
      default:
        break;
    }
  }
}
