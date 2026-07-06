import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Tournaments from "./pages/Tournaments.jsx";
import Players from "./pages/Players.jsx";
import Tournament from "./pages/Tournament.jsx";
import Player from "./pages/Player.jsx";
import Predictor from "./pages/Predictor.jsx";
import Data from "./pages/Data.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Predictor />} />
          <Route path="/ranking" element={<Dashboard />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/players" element={<Players />} />
          <Route path="/data" element={<Data />} />
          <Route path="/tournament/:id" element={<Tournament />} />
          <Route path="/player/:id" element={<Player />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
