import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Ranking from "./pages/Ranking.jsx";
import Tournaments from "./pages/Tournaments.jsx";
import Tournament from "./pages/Tournament.jsx";
import Player from "./pages/Player.jsx";
import Pair from "./pages/Pair.jsx";
import Home from "./pages/Home.jsx";
import Coulisses from "./pages/Coulisses.jsx";
import Sante from "./pages/Sante.jsx";
import Predictor from "./pages/Predictor.jsx";
import Rentabilite from "./pages/Rentabilite.jsx";
import "./styles.css";

const OLD_ROUTES = ["/odds", "/fiabilite", "/data", "/changelog"];

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/classement" element={<Ranking />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/coulisses" element={<Coulisses />} />
          <Route path="/sante" element={<Sante />} />
          <Route path="/predictor" element={<Predictor />} />
          <Route path="/rentabilite" element={<Rentabilite />} />
          {OLD_ROUTES.map((p) => (
            <Route key={p} path={p} element={<Navigate to="/coulisses" replace />} />
          ))}
          <Route path="/tournament/:id" element={<Tournament />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/pair/:key" element={<Pair />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
