import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Login    from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Terminal  from "./pages/Terminal";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/terminal"  element={<ProtectedRoute><Terminal /></ProtectedRoute>} />
        <Route path="*"         element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
