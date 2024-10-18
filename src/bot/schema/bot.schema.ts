import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument } from 'mongoose';
import { BotMoney } from 'src/middle-event/dto/dto.event';

export type BotDocument = HydratedDocument<Bot>;

@Schema({
  timestamps: true,
})
export class Bot {
  @Prop({ unique: true })
  id: string;

  @Prop()
  uuid: string;

  @Prop()
  name: string;

  @Prop()
  map: string;

  @Prop()
  zone: string;

  @Prop()
  type_money: BotMoney;

  @Prop()
  money: number;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const BotSchema = SchemaFactory.createForClass(Bot);
