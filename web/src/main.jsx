import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Ranking from "./pages/Ranking.jsx";
import Tournaments from "./pages/Tournaments.jsx";
import Tournament from "./pages/Tournament.jsx";
import Player from "./pages/Player.jsx";
import Pair from "./pages/Pair.jsx";
import Predictor from "./pages/Predictor.jsx";
import Home from "./pages/Home.jsx";
import Odds from "./pages/Odds.jsx";
import Changelog from "./pages/Changelog.jsx";
import Data from "./pages/Data.jsx";
import Reliability from "./pages/Reliability.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/classement" element={<Ranking />} />
          <Route path="/predictor" element={<Predictor />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/odds" element={<Odds />} />
          <Route path="/fiabilite" element={<Reliability />} />
          <Route path="/data" element={<Data />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/tournament/:id" element={<Tournament />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/pair/:key" element={<Pair />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
