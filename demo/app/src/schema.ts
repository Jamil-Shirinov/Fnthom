import { z } from "zod";

export const WeatherResponse = z.object({
  city: z.string(),
  temperatureC: z.number(),
  conditions: z.string(),
  fetchedAt: z.string().datetime(),
});

export type WeatherResponse = z.infer<typeof WeatherResponse>;
