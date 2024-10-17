import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { BotModule } from './bot/bot.module';
import { ServiceModule } from './service/service.module';
import { MinigameModule } from './minigame/minigame.module';
import { SocketGateway } from './socket/socket.gateway';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MiddleEventService } from './middle-event/middle-event.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(process.env.URI_DATABASE),
    EventEmitterModule.forRoot(),
    BotModule,
    ServiceModule,
    MinigameModule,
  ],
  controllers: [AppController],
  providers: [AppService, SocketGateway, MiddleEventService],
})
export class AppModule {}
