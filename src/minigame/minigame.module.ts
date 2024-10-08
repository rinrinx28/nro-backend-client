import { Module } from '@nestjs/common';
import { MinigameService } from './minigame.service';

@Module({
  providers: [MinigameService]
})
export class MinigameModule {}
