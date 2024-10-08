import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument } from 'mongoose';

export type BotDocument = HydratedDocument<Bot>;

@Schema({
  timestamps: true,
})
export class Bot {
  @Prop()
  name: string;

  @Prop({ unique: true })
  id: string;

  @Prop({ default: 0 })
  gold: number;

  @Prop()
  server: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const BotSchema = SchemaFactory.createForClass(Bot);
