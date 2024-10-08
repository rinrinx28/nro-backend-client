import { Controller, Get, Param, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  // API 1: Nhân kết quả thông báo
  @Get('/client/:UUID/info')
  async statusNoticeBoss(
    @Param('UUID') uuid: string,
    @Query('text') text: string,
    @Query('server') server: string,
  ) {
    console.log(`UUID: ${uuid} - Text: ${text} - Server: ${server}`);
    return 'ok';
  }

  // API 2: Cập nhật thông tin Bot
  @Get('/client/:UUID/bot')
  async updateInfoBot(
    @Param('UUID') uuid: string,
    @Query('id') id: string,
    @Query('name') name: string,
    @Query('map') map: string,
    @Query('zone') zone: string,
    @Query('gold') gold: string,
    @Query('server') server: string,
  ) {
    console.log(
      `UUID: ${uuid} - BotId: ${id} - Bot Name: ${name} - Bot Map: ${map} - Bot zone: ${zone} - Bot Gold: ${gold} - Bot Server: ${server}`,
    );
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
    @Query('server_id') service_id: string,
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
        console.log(
          `Query Service: Player ID:${player_id} - Player Name: ${player_name} - Bot Id: ${bot_id} - Server: ${server}`,
        );
        return 'no|Bạn chưa tạo giao dịch!';
      case '1':
        // TODO Data Query: bot_id, player_id, service_id, server
        // /     + bot_id: id của bot
        // /     + service_id: id của người chơi
        // /     + player_id: tên của người chơi
        // / - web nhận được data -> trả về ok
        // / - api này tạm thời chỉ để lưu log -> sau có thể check để cho vào danh sách đen, giao dịch trong game bị hủy nhưng giao dịch trên web vẫn để đó,
        // / không tự động xóa khi chưa vượt timeout để cho phép người chơi bấm hủy
        console.log(
          `Cancel Service: ServiceId: ${service_id} - Player Id: ${player_id} - Bot Id: ${bot_id}`,
        );
        return 'ok';
      case '2':
        // TODO Data Query: bot_id, player_id, service_id, money_last, money_current, money_trade, money_receive, server
        // / + money_last: vàng/thỏi vàng trước giao dịch của bot
        // / + money_current: vàng/thỏi vàng sau giao dịch của bot (vàng/thỏi vàng hiện tại)
        // / + money_trade: vàng/thỏi vàng mà bot giao dịch
        // / + money_receive: vàng/thỏi vàng mà người chơi giao dịch
        return 'ok';
      default:
        break;
    }
  }
}
