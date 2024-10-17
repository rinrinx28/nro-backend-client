import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SocketGateway } from 'src/socket/socket.gateway';
import { BotStatuEvent, NoticeInfoEvent } from './dto/dto.event';

@Injectable()
export class MiddleEventService {
  constructor(private readonly socketGateway: SocketGateway) {}
  private logger: Logger = new Logger('Middle Handler');

  @OnEvent('bot.status', { async: true })
  handleBotStatus(payload: BotStatuEvent) {
    console.log(payload);
  }

  @OnEvent('notice.info', { async: true })
  handleNoticeInfo(payload: NoticeInfoEvent) {
    console.log(payload);
  }
}
