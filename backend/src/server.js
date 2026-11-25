const app = require('./app');
const { env, serviceStatus } = require('./config/env');

app.listen(env.port, () => {
  const s = serviceStatus();
  console.log(`MedDet backend on http://localhost:${env.port}`);
  console.log(`  Movie/TV (Gemini + TMDB): ${s.movie ? 'ready' : 'NOT configured -> set GEMINI_API_KEY and TMDB_API_KEY'}`);
  console.log(`  Music (ACRCloud):         ${s.music ? 'ready' : 'NOT configured -> set ACRCLOUD_HOST / _ACCESS_KEY / _ACCESS_SECRET'}`);
});
