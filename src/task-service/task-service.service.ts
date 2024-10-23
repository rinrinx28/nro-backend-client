import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class TasksService {
  constructor(private emitEvent2: EventEmitter2) {}
  // Cron job: Executes at the 45th second of every minute
  @Cron('0 */1 * * * *')
  handlerMiniServer() {
    // this.emitEvent2.emitAsync('mini.server.24', 'run');
  }
}
