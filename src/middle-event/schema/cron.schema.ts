import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({
  timestamps: true,
})
export class Cron extends Document {
  @Prop({ required: true })
  serviceId: string;

  @Prop({ required: true })
  cancelTime: Date;

  @Prop({ default: false })
  isEnd: boolean;

  updatedAt?: Date;
  createdAt?: Date;
}

export const CronSchema = SchemaFactory.createForClass(Cron);
