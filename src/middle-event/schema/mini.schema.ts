import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type MiniGameDocument = HydratedDocument<MiniGame>;

@Schema({
  timestamps: true,
})
export class MiniGame {
  @Prop()
  uuid: string;

  @Prop({ default: false })
  isEnd: boolean;

  @Prop({ default: '' })
  result: string;

  @Prop()
  lastResult: string;

  @Prop()
  server: string;

  @Prop({ type: SchemaTypes.Date })
  timeEnd: Date;

  @Prop({ default: {}, type: SchemaTypes.Mixed })
  resultUser: Record<string, any>;

  updatedAt?: Date;
  createdAt?: Date;
}

export const MiniGameSchema = SchemaFactory.createForClass(MiniGame);
