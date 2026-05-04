import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, requestIdHeader: 'x-request-id' }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  const port = Number(process.env.FINANCIAL_CORE_PORT ?? 3080);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`financial-core listening on ${port}`);
}

bootstrap();
