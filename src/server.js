/* ============================================================
   THE ROYAL ORDER OF THE DARK FORCE OF MATTER
   Backend server — identity, contribution tracking, admin API
   Deploy target: Railway (Node + Postgres)
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const membersRoutes = require('./routes/members');
const cometsRoutes  = require('./routes/comets');
const planetsRoutes = require('./routes/planets');
const oauthRoutes   = require('./routes/oauth');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'The void is listening.', service: 'trotdfm-backend' });
});

app.use('/api/members', membersRoutes);
app.use('/api/comets', cometsRoutes);
app.use('/api/planets', planetsRoutes);
app.use('/oauth', oauthRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Order backend is listening on port ${PORT}`);
});
