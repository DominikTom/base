// Typy współdzielone między backendem asystenta a UI czatu.

export type Artifact =
  | {
      type: 'table';
      title?: string;
      columns: string[];
      rows: Record<string, unknown>[];
      truncated: boolean;
    }
  | {
      type: 'chart';
      title: string;
      chart_type: 'bar' | 'line' | 'area' | 'pie';
      x_key: string;
      series: string[];
      data: Record<string, unknown>[];
    }
  | {
      type: 'widget_created';
      title: string;
      layoutName: string;
    }
  | {
      type: 'kpi_created';
      kpiId: string;
      name: string;
      category: string;
    }
  | {
      type: 'error';
      message: string;
    };

// Wiadomość w formie gotowej do wyświetlenia w UI.
export interface ChatMessageDTO {
  role: 'user' | 'assistant';
  content: string;
  artifacts?: Artifact[];
  createdAt?: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

export interface ChatResponse {
  conversationId: string;
  reply: ChatMessageDTO;
}
