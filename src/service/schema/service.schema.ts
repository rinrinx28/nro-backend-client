import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, Types } from 'mongoose';

export type ServiceDocument = HydratedDocument<Service>;

type TypeService = '0' | '1' | '2' | '3';

@Schema({
  timestamps: true,
})
export class Service {
  @Prop({ type: Types.ObjectId, ref: `User` })
  uid: Types.ObjectId;

  @Prop()
  playerName: string;

  @Prop({ default: '' })
  playerId: string;

  @Prop()
  amount: number;

  @Prop({ default: 0 })
  revice: number;

  @Prop()
  type: TypeService;

  @Prop({ default: '0' })
  status: string;

  @Prop({ default: false })
  isEnd: boolean;

  @Prop({ default: '' })
  bot_id: string;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);
