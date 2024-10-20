import { Module } from '@nestjs/common';
import { MiddleEventService } from './middle-event.service';
import { MongooseModule } from '@nestjs/mongoose';
import { MiniGame, MiniGameSchema } from './schema/mini.schema';
import { User, UserSchema } from 'src/user/schema/user.schema';
import { SocketGateway } from 'src/socket/socket.gateway';
import {
  UserActive,
  UserActiveSchema,
} from 'src/user/schema/userActive.schema';
import { ResultMiniGame, ResultMiniGameSchema } from './schema/result.schema';
import { EConfig, EConfigSchema } from './schema/config.schema';
import { UserBet, UserBetSchema } from 'src/user/schema/userBet.schema';
import { SocketModule } from 'src/socket/socket.module';
import { Message, MessageSchema } from 'src/user/schema/message.schema';
import { Bot, BotSchema } from 'src/bot/schema/bot.schema';
import { Clan, ClanSchema } from './schema/clan.schema';
import { Session, SessionSchema } from './schema/ISession.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MiniGame.name,
        schema: MiniGameSchema,
      },
      {
        name: ResultMiniGame.name,
        schema: ResultMiniGameSchema,
      },
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: UserActive.name,
        schema: UserActiveSchema,
      },
      {
        name: UserBet.name,
        schema: UserBetSchema,
      },
      {
        name: EConfig.name,
        schema: EConfigSchema,
      },
      {
        name: Message.name,
        schema: MessageSchema,
      },
      { name: Bot.name, schema: BotSchema },
      { name: Clan.name, schema: ClanSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    SocketModule,
  ],
  providers: [MiddleEventService],
})
export class MiddleEventModule {}
