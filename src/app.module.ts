import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { BotModule } from './bot/bot.module';
import { ServiceModule } from './service/service.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './task-service/task-service.service';
import { MiddleEventModule } from './middle-event/middle-event.module';
import { SocketModule } from './socket/socket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(process.env.URI_DATABASE),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    BotModule,
    ServiceModule,
    MiddleEventModule,
    SocketModule,
  ],
  controllers: [AppController],
  providers: [AppService, TasksService],
})
export class AppModule {}
