import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { stripAccessKey } from "./accessKey";
import { persistHome, reloadedHome } from "./home/homePersist";
import { newQueryClient } from "./queryClient";
import { createAppRouter } from "./router";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const queryClient = newQueryClient();
// Before the router reads the URL.
stripAccessKey(window.location, window.history);
const router = createAppRouter();

// Home's last answers first (homePersist.ts): Home shows them at once.
void persistHome(queryClient, { restore: !reloadedHome() }).then(() => {
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	);
});
