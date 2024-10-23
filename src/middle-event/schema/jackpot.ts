import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type JackpotDocument = HydratedDocument<Jackpot>;

@Schema({
  timestamps: true,
})
export class Jackpot {
  @Prop()
  server: string;

  @Prop({ default: 0 })
  score: number;

  updatedAt?: Date;
  createdAt?: Date;
}

export const JackpotSchema = SchemaFactory.createForClass(Jackpot);
