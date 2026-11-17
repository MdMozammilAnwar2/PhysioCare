import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './ui';
import { AboutYou, Bookings, ChoosePayment, Home, PaymentPage, Physio, RequireAuth, SignIn, Time, Where } from './pages';

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/about-you" element={<RequireAuth><AboutYou /></RequireAuth>} />
          <Route path="/book" element={<RequireAuth><Where /></RequireAuth>} />
          <Route path="/book/physio" element={<RequireAuth><Physio /></RequireAuth>} />
          <Route path="/book/time" element={<RequireAuth><Time /></RequireAuth>} />
          <Route path="/book/pay" element={<RequireAuth><ChoosePayment /></RequireAuth>} />
          <Route path="/payments/:id" element={<RequireAuth><PaymentPage /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
