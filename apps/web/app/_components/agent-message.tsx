import type { Spec } from "@json-render/react";
import { signInEnding } from "eve/events";
import type { Answer, Interaction } from "eve/events";
import type { EveMessage, EveMessagePart, EveToolPart } from "eve/react";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  XCircleIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import type { SubmitEvent } from "react";
import { z } from "zod";

import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  BashToolContent,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { ToolHeaderProps } from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import { cn } from "@/lib/utils";

import { GeneratedUi, uiSpecSchema } from "./ui-registry";

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;
type CanRespond = (interactionId: string) => boolean;
type OnInputResponses = (responses: readonly Answer[]) => Promise<void>;

const AUTHORIZATION_OUTCOME_LABEL: Record<
  ReturnType<typeof signInEnding>,
  string
> = {
  cancelled: "Cancelled",
  connected: "Connected",
  declined: "Declined",
  failed: "Failed",
  "timed out": "Timed out",
};

/**
 * Renders one chat message and each of its parts.
 *
 * @param props - The component props.
 * @returns The message.
 */
export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
}: {
  /** Whether the interaction with this ID still accepts an answer. */
  readonly canRespond: CanRespond;
  /** Whether this message is the one currently streaming. */
  readonly isStreaming: boolean;
  /** The message to render. */
  readonly message: EveMessage;
  /** Submits answers to questions and approvals. */
  readonly onInputResponses: OnInputResponses;
}) {
  const lastTextIndex = message.parts.findLastIndex(
    (part) => part.type === "text"
  );
  const hasAssistantText =
    message.role === "assistant" &&
    message.parts.some((part) => part.type === "text" && part.text.length > 0);

  return (
    <Message
      data-optimistic={
        message.metadata?.optimistic === true ? "true" : undefined
      }
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) =>
          hasAssistantText && part.type === "reasoning" ? null : (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(part, index)}
              onInputResponses={onInputResponses}
              part={part}
              showCaret={
                isStreaming &&
                message.role === "assistant" &&
                index === lastTextIndex
              }
            />
          )
        )}
      </MessageContent>
    </Message>
  );
}

/**
 * Renders one message part: text, reasoning, an attachment, an authorization
 * prompt, a tool call, or the questions a tool call asked.
 *
 * @param props - The component props.
 * @returns The rendered part, or `null` for parts with nothing to show.
 */
function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
}: {
  /** Whether the interaction with this ID still accepts an answer. */
  readonly canRespond: CanRespond;
  /** Submits answers to questions and approvals. */
  readonly onInputResponses: OnInputResponses;
  /** The part to render. */
  readonly part: EveMessagePart;
  /** Whether to show the streaming caret after this text part. */
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "text": {
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    }
    case "reasoning": {
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    }
    case "file": {
      return <AttachmentPart part={part} />;
    }
    case "interaction": {
      return (
        <InteractionPrompt
          canRespond={canRespond(part.interactionId)}
          interaction={part}
          onInputResponses={onInputResponses}
        />
      );
    }
    case "tool": {
      const spec = renderUiSpec(part);
      if (spec === null) {
        return null;
      }
      if (spec !== undefined) {
        return <GeneratedUi spec={spec} />;
      }
      return (
        <ToolPart
          canRespond={canRespond}
          onInputResponses={onInputResponses}
          part={part}
        />
      );
    }
    default: {
      return null;
    }
  }
}

function ToolPart({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: CanRespond;
  readonly onInputResponses: OnInputResponses;
  readonly part: EveToolPart;
}) {
  const { interaction } = part;
  return (
    <>
      {interaction?.request.kind === "question" ? null : (
        <Tool>
          <ToolHeader
            state={TOOL_HEADER_STATE[part.state]}
            title={part.label}
            toolName={part.name}
            type="dynamic-tool"
          />
          <ToolContent>
            {part.name === "bash" ? (
              <BashToolContent
                errorText={part.error?.message}
                input={part.input}
                output={part.output}
              />
            ) : (
              <>
                <ToolInput input={part.input} />
                <ToolOutput
                  errorText={part.error?.message}
                  output={part.output}
                />
              </>
            )}
          </ToolContent>
        </Tool>
      )}
      {interaction === undefined ? null : (
        <InteractionPrompt
          canRespond={canRespond(interaction.interactionId)}
          interaction={interaction}
          key={interaction.interactionId}
          onInputResponses={onInputResponses}
          toolLabel={part.label}
        />
      )}
    </>
  );
}

const TOOL_HEADER_STATE = {
  approval: "approval-requested",
  blocked: "input-available",
  cancelled: "output-error",
  completed: "output-available",
  failed: "output-error",
  rejected: "output-denied",
  requested: "input-available",
  running: "input-available",
  streaming: "input-streaming",
} satisfies Record<EveToolPart["state"], ToolHeaderProps["state"]>;

/**
 * Resolves what a tool part shows as generated UI.
 *
 * @param part - The tool call part.
 * @returns The spec to render, `null` to hide a rejected `render_ui` call, or
 * `undefined` for other tools and for input that is still streaming in.
 */
function renderUiSpec(part: EveToolPart): Spec | null | undefined {
  if (part.name !== "render_ui") {
    return undefined;
  }
  if (
    part.state === "failed" ||
    part.state === "rejected" ||
    part.state === "cancelled"
  ) {
    return null;
  }
  const parsed = uiSpecSchema.safeParse(part.input);
  return parsed.success ? parsed.data : undefined;
}

function InteractionPrompt({
  canRespond,
  interaction,
  onInputResponses,
  toolLabel,
}: {
  readonly canRespond: boolean;
  readonly interaction: Interaction;
  readonly onInputResponses: OnInputResponses;
  readonly toolLabel?: string;
}) {
  if (interaction.request.kind === "sign-in") {
    return <AuthorizationPrompt interaction={interaction} />;
  }
  if (interaction.request.kind === "question") {
    return (
      <QuestionRequest
        canRespond={canRespond}
        interaction={interaction}
        onInputResponses={onInputResponses}
      />
    );
  }
  return (
    <InputRequestActions
      canRespond={canRespond}
      interaction={interaction}
      onInputResponses={onInputResponses}
      toolLabel={toolLabel}
    />
  );
}

/**
 * A question from the agent, answered by choosing an option or typing a reply,
 * then shown as a compact row with the answer.
 *
 * @param props - The component props.
 * @returns The question form, or the answer once given.
 */
function QuestionRequest({
  canRespond,
  interaction,
  onInputResponses,
}: {
  /** Whether the question still accepts an answer. */
  readonly canRespond: boolean;
  /** The question and any recorded answer. */
  readonly interaction: Interaction;
  /** Submits the answer. */
  readonly onInputResponses: OnInputResponses;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { answer, interactionId, request } = interaction;
  const options = request.options ?? [];
  const acceptsFreeform =
    request.allowFreeform === true || options.length === 0;
  const isLocked = !canRespond || isSubmitting;

  if (interaction.status === "settled" && answer !== undefined) {
    return <AnsweredQuestion inputRequest={request} inputResponse={answer} />;
  }

  const submitResponse = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = z
      .string()
      .safeParse(new FormData(event.currentTarget).get(interactionId));
    if (isLocked || !value.success) {
      return;
    }

    const option = options.find(({ id }) => id === value.data);
    setIsSubmitting(true);
    await onInputResponses([
      option === undefined
        ? { interactionId, text: value.data.trim() }
        : { interactionId, optionId: option.id },
    ]);
    setIsSubmitting(false);
  };

  return (
    <div className="border-info/30 bg-info/5 w-full max-w-md rounded-md border p-3">
      <Questionnaire
        className="gap-3"
        onSubmit={(event) => {
          void submitResponse(event);
        }}
      >
        <QuestionnaireItem name={interactionId} required>
          <QuestionnaireTitle className="text-sm font-medium [&:not(:has(~[data-slot=questionnaire-description]))]:mb-3">
            {request.prompt}
          </QuestionnaireTitle>
          <QuestionnaireChoices className="gap-2">
            {options.map((option) => (
              <QuestionnaireChoice
                className="min-h-0 px-3 py-2"
                disabled={isLocked}
                key={option.id}
                value={option.id}
              >
                {option.label}
                {option.description === undefined ? null : (
                  <QuestionnaireChoiceDescription>
                    {option.description}
                  </QuestionnaireChoiceDescription>
                )}
              </QuestionnaireChoice>
            ))}
            {acceptsFreeform ? (
              <QuestionnaireInput
                aria-label="Answer"
                disabled={isLocked}
                placeholder="Type your answer…"
              />
            ) : null}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireActions>
          <QuestionnaireSubmit disabled={isLocked} size="sm">
            Answer
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  );
}

/**
 * An answered question: a row with the answer that expands to show the full
 * question and every option, with the chosen one highlighted.
 *
 * @param props - The component props.
 * @returns The collapsible answer.
 */
function AnsweredQuestion({
  inputRequest,
  inputResponse,
}: {
  /** The question. */
  readonly inputRequest: Interaction["request"];
  /** The submitted answer. */
  readonly inputResponse: Answer;
}) {
  const options = inputRequest.options ?? [];
  const answer =
    options.find(({ id }) => id === inputResponse.optionId)?.label ??
    inputResponse.text ??
    inputResponse.optionId;

  return (
    <div className="w-full max-w-md rounded-md border text-sm">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            className="group text-muted-foreground flex w-full items-center gap-2 px-3 py-2 text-left"
            type="button"
          >
            <ChevronRightIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            <span className="text-foreground shrink-0 font-medium">
              {answer}
            </span>
            <span className="truncate">{inputRequest.prompt}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t px-3 py-2">
            <p className="font-medium">{inputRequest.prompt}</p>
            <ul className="space-y-1">
              {options.map((option) => {
                const isChosen = option.id === inputResponse.optionId;
                return (
                  <li
                    className={cn(
                      "flex items-center gap-2",
                      isChosen
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    )}
                    key={option.id}
                  >
                    {isChosen ? (
                      <span className="border-primary bg-primary flex size-4 shrink-0 items-center justify-center rounded-full border">
                        <span className="bg-primary-foreground size-1.5 rounded-full" />
                      </span>
                    ) : (
                      <span className="border-input size-4 shrink-0 rounded-full border" />
                    )}
                    {option.label}
                  </li>
                );
              })}
            </ul>
            {inputResponse.text === undefined ? null : (
              <blockquote className="border-l-2 pl-3">
                {inputResponse.text}
              </blockquote>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * A file attached to a message, with an image preview when possible.
 *
 * @param props - The component props.
 * @returns The attachment, linked when it has a URL.
 */
function AttachmentPart({
  part,
}: {
  /** The file part. */
  readonly part: EveFilePart;
}) {
  const label = part.filename ?? "Attachment";
  const detail = [part.mediaType, formatBytes(part.size)]
    .filter(Boolean)
    .join(" - ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const isDataUrl = part.url?.startsWith("data:") === true;
  const LinkIcon = isDataUrl ? DownloadIcon : ExternalLinkIcon;
  const body = (
    <span className="bg-background/60 flex max-w-sm items-center gap-3 rounded-md border p-2 text-sm">
      {isImage ? (
        <img
          alt={label}
          className="size-12 shrink-0 rounded-sm object-cover"
          src={part.url}
        />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-sm">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail.length > 0 ? (
          <span className="text-muted-foreground block truncate">{detail}</span>
        ) : null}
      </span>
      {part.url === undefined ? null : (
        <LinkIcon className="text-muted-foreground size-4 shrink-0" />
      )}
    </span>
  );

  if (part.url === undefined) {
    return body;
  }
  return isDataUrl ? (
    <a download={part.filename ?? "attachment"} href={part.url}>
      {body}
    </a>
  ) : (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  );
}

/**
 * Asks the visitor to sign in to a connection, then shows the outcome.
 *
 * @param props - The component props.
 * @returns The authorization card.
 */
function AuthorizationPrompt({
  interaction,
}: {
  /** The connection sign-in interaction. */
  readonly interaction: Interaction;
}) {
  const { outcome, reason, request, status } = interaction;
  const { prompt, signIn } = request;
  const name = signIn?.displayName ?? signIn?.name ?? "the service";
  if (status === "settled") {
    const ending = signInEnding(outcome ?? "failed");
    const authorized = ending === "connected";
    const Icon = authorized ? CheckCircleIcon : XCircleIcon;
    return (
      <div className="text-muted-foreground flex w-full max-w-md items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon
          className={cn(
            "size-4 shrink-0",
            authorized ? "text-success" : "text-destructive"
          )}
        />
        <span className="text-foreground font-medium">
          {AUTHORIZATION_OUTCOME_LABEL[ending]}
        </span>
        <span className="truncate">
          {reason === undefined ? name : `${name} (${reason})`}
        </span>
      </div>
    );
  }

  const instructions = signIn?.instructions;
  const userCode = signIn?.userCode;
  const signInUrl = signIn?.url;

  return (
    <div className="border-info/30 bg-info/5 w-full max-w-md space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Connect {name}</p>
        <p className="text-muted-foreground text-sm">{prompt}</p>
        {instructions === undefined || instructions === prompt ? null : (
          <p className="text-muted-foreground text-sm">{instructions}</p>
        )}
      </div>
      {userCode === undefined ? null : (
        <div className="bg-background/60 flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Code</span>
          <code className="font-mono">{userCode}</code>
        </div>
      )}
      {signInUrl === undefined ? null : (
        <Button asChild size="sm">
          <a href={signInUrl} rel="noreferrer" target="_blank">
            <ExternalLinkIcon className="size-4" />
            Sign in with {name}
          </a>
        </Button>
      )}
    </div>
  );
}

/**
 * Formats a byte count for display.
 *
 * @param size - Size in bytes, if known.
 * @returns A string such as "1.5 KB", or `undefined` when the size is unknown.
 */
function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Most input fields the approval card lists before summarizing the rest. */
const MAX_SUMMARY_ROWS = 4;

const summaryValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/**
 * Parses a tool input into its top-level scalar fields, so the visitor can see
 * what they are approving without opening the tool card. Nested values are left out.
 */
const inputSummarySchema = z
  .record(z.string(), z.unknown())
  .transform((input) =>
    Object.entries(input).flatMap(([name, value]) => {
      const scalar = summaryValueSchema.safeParse(value);
      return scalar.success
        ? [
            [
              `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
              String(scalar.data),
            ] as const,
          ]
        : [];
    })
  );

/**
 * Labels settled interactions that did not produce a displayed answer.
 */
const INTERACTION_OUTCOME_LABEL = {
  abandoned: "Abandoned",
  accepted: "Approved",
  declined: "Cancelled",
  expired: "Expired",
  failed: "Failed",
  interrupted: "Interrupted",
  invalid: "Invalid response",
  withdrawn: "Withdrawn",
} satisfies Record<NonNullable<Interaction["outcome"]>, string>;

function settledOutcome(interaction: Interaction): string {
  const { answer, outcome, request } = interaction;
  if (request.kind !== "approval" && answer !== undefined) {
    const selected = request.options?.find(({ id }) => id === answer.optionId);
    return selected?.label ?? answer.text ?? answer.optionId ?? "Answered";
  }
  return outcome === undefined ? "Ended" : INTERACTION_OUTCOME_LABEL[outcome];
}

/**
 * Asks the visitor to approve a tool call, showing what the call will do, then
 * shows the decision once made.
 *
 * @param props - The component props.
 * @returns The approval card.
 */
function InputRequestActions({
  canRespond,
  interaction,
  onInputResponses,
  toolLabel,
}: {
  /** Whether the interaction still accepts an answer. */
  readonly canRespond: boolean;
  /** The interaction and any recorded decision. */
  readonly interaction: Interaction;
  /** Submits the chosen option. */
  readonly onInputResponses: OnInputResponses;
  /** The label from the corresponding tool card, when there is one. */
  readonly toolLabel?: string;
}) {
  const { call, interactionId, outcome, request, status } = interaction;
  const isApproval = request.kind === "approval";
  const title = toolLabel ?? request.title ?? call?.name ?? request.prompt;
  const summary = inputSummarySchema.safeParse(call?.input);
  const details = isApproval && summary.success ? summary.data : [];

  if (status === "settled") {
    const accepted = outcome === "accepted";
    const Icon = accepted ? CheckCircleIcon : XCircleIcon;
    return (
      <div className="text-muted-foreground flex w-full max-w-md items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon
          className={cn(
            "size-4 shrink-0",
            accepted ? "text-success" : "text-destructive"
          )}
        />
        <span className="text-foreground font-medium">
          {settledOutcome(interaction)}
        </span>
        {isApproval ? <span className="truncate">{title}</span> : null}
      </div>
    );
  }

  return (
    <div className="border-warning/30 bg-warning/5 w-full max-w-md space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {isApproval ? title : request.prompt}
        </p>
        {isApproval ? (
          <p className="text-muted-foreground text-sm">
            Review the details before approving.
          </p>
        ) : null}
      </div>
      {details.length > 0 ? (
        <dl className="bg-background/60 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
          {details.slice(0, MAX_SUMMARY_ROWS).map(([name, value]) => (
            <Fragment key={name}>
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="truncate">{value}</dd>
            </Fragment>
          ))}
          {details.length > MAX_SUMMARY_ROWS ? (
            <dd className="text-muted-foreground col-span-2">
              +{details.length - MAX_SUMMARY_ROWS} more in the tool details
            </dd>
          ) : null}
        </dl>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {request.options?.map((option, index) => (
          <Button
            disabled={!canRespond}
            key={option.id}
            onClick={() => {
              void onInputResponses([{ interactionId, optionId: option.id }]);
            }}
            size="sm"
            type="button"
            variant={optionVariant(option.style, index)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Picks the button variant for an approval option.
 *
 * @param style - The option's style, if eve set one.
 * @param index - The option's position; the first option is the primary action.
 * @returns The button variant.
 */
function optionVariant(
  style: "danger" | "default" | "primary" | undefined,
  index: number
): "default" | "destructive" | "outline" {
  if (style === "danger") {
    return "destructive";
  }
  return style === "primary" || index === 0 ? "default" : "outline";
}

/**
 * Builds a stable React key for a message part.
 *
 * @param part - The message part.
 * @param index - The part's position, used when it has no ID of its own.
 * @returns The key.
 */
function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "interaction": {
      return `interaction:${part.interactionId}`;
    }
    case "tool": {
      return part.callId;
    }
    case "reasoning":
    case "text": {
      return `${part.type}:${part.id ?? index}`;
    }
    case "file": {
      return `${part.type}:${index}`;
    }
    default: {
      return String(index);
    }
  }
}
