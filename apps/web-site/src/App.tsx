import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './ui';
import { AboutYou, Bookings, ChoosePayment, Home, PaymentPage, Physio, RequireAuth, SignIn, Time, Where } from './pages';
import { Chat, Plans, RateVisit, ReportProblem } from './trust-pages';
import { PartnerPortal, Rewards } from './growth-pages';
import { GrievancePage, GrievanceThread } from './grievance-pages';

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
          <Route path="/plans" element={<RequireAuth><Plans /></RequireAuth>} />
          <Route path="/visits/:id/rate" element={<RequireAuth><RateVisit /></RequireAuth>} />
          <Route path="/visits/:id/report" element={<RequireAuth><ReportProblem /></RequireAuth>} />
          <Route path="/chat/:planId" element={<RequireAuth><Chat /></RequireAuth>} />
          <Route path="/rewards" element={<RequireAuth><Rewards /></RequireAuth>} />
          <Route path="/partner" element={<PartnerPortal />} />
          <Route path="/grievance" element={<GrievancePage />} />
          <Route path="/grievance/:id" element={<RequireAuth><GrievanceThread /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
