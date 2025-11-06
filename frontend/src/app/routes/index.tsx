import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './Landing';
import SignIn from './SignIn';
import SignUp from './SignUp';
import Chat from './Chat';
import Settings from './Settings';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
