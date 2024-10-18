import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Date, HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type ResultMiniGameDocument = HydratedDocument<ResultMiniGame>;

@Schema({
  timestamps: true,
})
export class ResultMiniGame {
  @Prop()
  miniId: string;

  @Prop()
  result: string;

  updatedAt?: Date;
  createdAt?: Date;
}

export const ResultMiniGameSchema =
  SchemaFactory.createForClass(ResultMiniGame);
