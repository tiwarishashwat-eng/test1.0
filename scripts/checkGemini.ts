/**
 * Makes one real Gemini request with the configured key and model, and reports
 * whether it succeeded. This is the only check that proves the live API works;
 * `npm test` uses mocked clients.
 *
 *   npm run check:gemini
 */
import dotenv from 'dotenv';
dotenv.config();

const { analyzeComplaintWithGemini, getGeminiStatus } = await import('../src/server/geminiService.js');

const status = getGeminiStatus();
if (!status.configured) {
  console.error('GEMINI_API_KEY is not set. Nothing to check.');
  process.exit(1);
}

console.log(`Calling ${status.model} ...`);
const result = await analyzeComplaintWithGemini({
  description: 'Washroom ka nal leak ho raha hai, floor pe paani bhar gaya hai',
  building: 'Main Academic Building',
  location: '2nd floor washroom'
});

if (result.isAiFallback) {
  console.error(`FAILED: Gemini was not used (reason: ${result.fallbackReason}). See the [Gemini] log line above.`);
  process.exit(1);
}

console.log(`OK: real Gemini response from ${result.model}`);
console.log(JSON.stringify(result, null, 2));
