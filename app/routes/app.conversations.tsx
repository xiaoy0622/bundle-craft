import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getConversations, getConversationStats } from "../models/chat.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const page = Number(url.searchParams.get("page") || "1");

  const [result, stats] = await Promise.all([
    getConversations(session.shop, status, page),
    getConversationStats(session.shop),
  ]);

  return { ...result, stats, status };
};

export default function Conversations() {
  const { conversations, total, page, limit, stats, status } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [filter, setFilter] = useState(status);
  const filterRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 15_000);
    return () => clearInterval(interval);
  }, [revalidator]);

  useEffect(() => {
    const el = filterRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const value = (e.currentTarget as HTMLSelectElement).value;
      setFilter(value);
      navigate(`/app/conversations?status=${value}`);
    };
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, [navigate]);

  const totalPages = Math.ceil(total / limit);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <s-page heading="Conversations">
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
        {[
          { label: "Total", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Escalated", value: stats.escalated },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              padding: "12px 20px",
              background: "#fff",
              border: "1px solid #e3e3e3",
              borderRadius: "8px",
              textAlign: "center",
              minWidth: "80px",
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>{s.label}</div>
          </div>
        ))}
      </div>

      <s-section>
        <div style={{ marginBottom: "12px" }}>
          <s-select ref={filterRef} label="Filter" value={filter}>
            <s-option value="all">All conversations</s-option>
            <s-option value="active">Active</s-option>
            <s-option value="escalated">Escalated</s-option>
            <s-option value="closed">Closed</s-option>
          </s-select>
        </div>

        {conversations.length === 0 ? (
          <s-empty-state heading="No conversations yet">
            <s-text>
              Conversations will appear here when customers start chatting on
              your store.
            </s-text>
          </s-empty-state>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {conversations.map((conv) => {
              const lastMessage = conv.messages[0];
              const preview = lastMessage
                ? lastMessage.content.replace(/\*\*/g, "").slice(0, 100) +
                  (lastMessage.content.length > 100 ? "…" : "")
                : "No messages yet";
              const lastSender =
                lastMessage?.senderType === "customer"
                  ? "Customer"
                  : lastMessage?.senderType === "ai"
                    ? "AI"
                    : "You";

              const badgeColor =
                conv.status === "escalated"
                  ? { bg: "#fef3c7", color: "#92400e" }
                  : conv.status === "closed"
                    ? { bg: "#e5e7eb", color: "#374151" }
                    : { bg: "#dbeafe", color: "#1e40af" };

              return (
                <div
                  key={conv.id}
                  onClick={() => navigate(`/app/conversations/${conv.id}`)}
                  style={{
                    padding: "14px 16px",
                    background: "#fff",
                    border: "1px solid #e3e3e3",
                    borderRadius: "8px",
                    cursor: "pointer",
                    transition: "box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.boxShadow =
                      "0 1px 6px rgba(0,0,0,0.1)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.boxShadow = "none")
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginBottom: "4px",
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>
                          {conv.customerEmail ||
                            conv.customerName ||
                            "Anonymous"}
                        </span>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            fontWeight: 600,
                            background: badgeColor.bg,
                            color: badgeColor.color,
                          }}
                        >
                          {conv.status}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "#6b7280",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {lastSender}: {preview}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "#9ca3af",
                        whiteSpace: "nowrap",
                        marginLeft: "12px",
                      }}
                    >
                      {formatTime(conv.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}

            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                  paddingTop: "12px",
                }}
              >
                {page > 1 && (
                  <s-button
                    onClick={() =>
                      navigate(
                        `/app/conversations?status=${filter}&page=${page - 1}`,
                      )
                    }
                  >
                    Previous
                  </s-button>
                )}
                <span style={{ fontSize: "13px", color: "#6b7280" }}>
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <s-button
                    onClick={() =>
                      navigate(
                        `/app/conversations?status=${filter}&page=${page + 1}`,
                      )
                    }
                  >
                    Next
                  </s-button>
                )}
              </div>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
