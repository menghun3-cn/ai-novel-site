/**
 * Pino 结构化日志，同时输出到 stdout 与 logs/ 文件。
 */
import pino, { type Logger } from 'pino';

export function createLogger(logsDir: string, level: pino.Level = 'info'): Logger {
  const fileStream = pino.destination(`${logsDir}/novel-builder.log`);
  const streams = [
    { level, stream: process.stdout },
    { level, stream: fileStream },
  ];

  return pino(
    {
      level,
      base: { service: 'novel-builder' },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream(streams),
  );
}
