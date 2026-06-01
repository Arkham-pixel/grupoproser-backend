import { CronExpressionParser } from 'cron-parser';

/** Próxima ejecución de una expresión cron (cron-parser v5+). */
export function getNextCronRun(schedule, tz = 'America/Bogota') {
  const interval = CronExpressionParser.parse(schedule, { tz });
  return new Date(interval.next().getTime());
}
