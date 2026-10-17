import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { db, result } from './db.js';

const accounts = [
  { role: 'mentor', name: process.env.MENTOR_NAME, email: process.env.MENTOR_EMAIL, password: process.env.MENTOR_PASSWORD },
  { role: 'student', name: process.env.STUDENT_NAME, email: process.env.STUDENT_EMAIL, password: process.env.STUDENT_PASSWORD },
];
if (accounts.some(a => !a.name || !a.email || !a.password)) throw new Error('Set mentor/student names, emails, and passwords in .env before seeding.');
if (accounts.some(a => a.password!.length < 12)) throw new Error('Both account passwords must be at least 12 characters.');
if (accounts[0].email!.toLowerCase() === accounts[1].email!.toLowerCase()) throw new Error('Mentor and student must use different email addresses.');

for (const account of accounts) {
  const email = account.email!.toLowerCase();
  const found = await result<any>(db.from('app_users').select('id').eq('email', email).maybeSingle());
  if (found) {
    console.log(`Already configured ${account.role} account ${email}; kept its existing password.`);
    continue;
  }
  const hash = await bcrypt.hash(account.password!, 12);
  await result(db.from('app_users').insert({ name: account.name, email, role: account.role, password_hash: hash }));
  console.log(`Created ${account.role} account ${email}`);
}
