import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { BotModule } from './bot/bot.module';
import { UserModule } from './user/user.module';
import { ServiceModule } from './service/service.module';
import { MinigameModule } from './minigame/minigame.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRoot(process.env.URI_DATABASE),
    BotModule,
    UserModule,
    ServiceModule,
    MinigameModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
