import { PRESET_SCENARIOS } from '@/lib/scenarios';
import { jsonOk } from '@/lib/api-response';

export async function GET() {
  return jsonOk(
    PRESET_SCENARIOS.map(({ id, name, description, steps }) => ({
      id,
      name,
      description,
      stepCount: steps.length,
    }))
  );
}
