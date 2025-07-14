import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class TasksService {
  constructor(private emitEvent2: EventEmitter2) {}
  // Cron job: Executes at the 45th second of every minute
  @Cron('0 */1 * * * *')
  handlerMiniServer() {
    this.emitEvent2.emitAsync('mini.server.24', 'run');
  }
  // Cron job: Executes every 5 minutes from 6 AM to 11:59 PM (6:00-23:59)
  @Cron('0 */5 6-23 * * *')
  handlerMainServers() {
    const mainServerList = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '11',
      '12',
      '13',
    ];
    for (const server of mainServerList) {
      this.emitEvent2.emitAsync('main.server', server);
    }
  }
}
