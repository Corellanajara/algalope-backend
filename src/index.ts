import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/auth';
import racetrackRoutes from './routes/racetracks';
import raceRoutes from './routes/races';
import reunionRoutes from './routes/reuniones';
import pickRoutes from './routes/picks';
import resultRoutes from './routes/results';
import userRoutes from './routes/users';
import leaderboardRoutes from './routes/leaderboard';
import programaRoutes from './routes/programas';
import adminRoutes from './routes/admins';
import { errorHandler } from './middleware/error';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/racetracks', racetrackRoutes);
app.use('/api/races', raceRoutes);
app.use('/api/reuniones', reunionRoutes);
app.use('/api/picks', pickRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/programas', programaRoutes);
app.use('/api/admins', adminRoutes);

app.use(errorHandler);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`🏇 Algalope API escuchando en http://localhost:${PORT}`);
});
