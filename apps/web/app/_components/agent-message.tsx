import type { Spec } from "@json-render/react";
import type { Answer } from "eve/events";
import { signInEnding } from "eve/react";
import type {
  EveMessage,
  EveMessagePart,
  EveToolPart,
  Interaction,
} from "eve/react";
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
type OnInputResponses = (responses: readonly Answer[]) => void | Promise<void>;

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
  /** Whether an interaction remains answerable. */
  readonly canRespond: (interactionId: string) => boolean;
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
 * prompt, a tool call, or a question the agent asked.
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
  /** Whether an interaction remains answerable. */
  readonly canRespond: (interactionId: string) => boolean;
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
          canRespond={canRespond}
          interaction={part}
          onInputResponses={onInputResponses}
        />
      );
    }
    case "tool": {
      if (part.interaction?.request.kind === "question") {
        return (
          <InteractionPrompt
            canRespond={canRespond}
            interaction={part.interaction}
            onInputResponses={onInputResponses}
            tool={part}
          />
        );
      }
      const spec = renderUiSpec(part);
      if (spec === null) {
        return null;
      }
      if (spec !== undefined) {
        return <GeneratedUi spec={spec} />;
      }
      return (
        <>
          <Tool>
            <ToolHeader
              state={toolState(part.state)}
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
          {part.interaction === undefined ? null : (
            <InteractionPrompt
              canRespond={canRespond}
              interaction={part.interaction}
              onInputResponses={onInputResponses}
              tool={part}
            />
          )}
        </>
      );
    }
    default: {
      return null;
    }
  }
}

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
  if (part.state === "failed") {
    return null;
  }
  const parsed = uiSpecSchema.safeParse(part.input);
  return parsed.success ? parsed.data : undefined;
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
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  /** Whether the question still accepts an answer. */
  readonly canRespond: boolean;
  /** The question. */
  readonly inputRequest: Interaction;
  /** The submitted answer, once there is one. */
  readonly inputResponse?: Answer;
  /** Submits the answer. */
  readonly onInputResponses: OnInputResponses;
}) {
  const [submittedResponse, setSubmittedResponse] = useState<Answer>();
  const options = inputRequest.request.options ?? [];
  const acceptsFreeform =
    inputRequest.request.allowFreeform === true || options.length === 0;
  const answeredResponse =
    inputResponse ?? (canRespond ? undefined : submittedResponse);

  if (answeredResponse !== undefined) {
    return (
      <AnsweredQuestion
        inputRequest={inputRequest}
        inputResponse={answeredResponse}
      />
    );
  }

  const submitResponse = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = new FormData(event.currentTarget).get(
      inputRequest.interactionId
    );
    if (answer === null || answer instanceof File) {
      return;
    }

    const option = options.find(({ id }) => id === answer);
    const response: Answer =
      option === undefined
        ? { interactionId: inputRequest.interactionId, text: answer.trim() }
        : { interactionId: inputRequest.interactionId, optionId: option.id };
    setSubmittedResponse(response);
    void onInputResponses([response]);
  };

  return (
    <div className="border-info/30 bg-info/5 w-full max-w-md rounded-md border p-3">
      <Questionnaire className="gap-3" onSubmit={submitResponse}>
        <QuestionnaireItem name={inputRequest.interactionId} required>
          <QuestionnaireTitle className="text-sm font-medium [&:not(:has(~[data-slot=questionnaire-description]))]:mb-3">
            {inputRequest.request.prompt}
          </QuestionnaireTitle>
          <QuestionnaireChoices className="gap-2">
            {options.map((option) => (
              <QuestionnaireChoice
                className="min-h-0 px-3 py-2"
                disabled={!canRespond}
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
                disabled={!canRespond}
                placeholder="Type your answer…"
              />
            ) : null}
          </QuestionnaireChoices>
          <QuestionnaireError />
        </QuestionnaireItem>
        <QuestionnaireActions>
          <QuestionnaireSubmit disabled={!canRespond} size="sm">
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
  readonly inputRequest: Interaction;
  /** The submitted answer. */
  readonly inputResponse: Answer;
}) {
  const options = inputRequest.request.options ?? [];
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
            <span className="truncate">{inputRequest.request.prompt}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t px-3 py-2">
            <p className="font-medium">{inputRequest.request.prompt}</p>
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
 * Dispatches a question, sign-in request, or approval prompt.
 *
 * @param props - The component props.
 * @returns The interaction prompt.
 */
function InteractionPrompt({
  canRespond,
  interaction,
  onInputResponses,
  tool,
}: {
  /** Whether an interaction remains answerable. */
  readonly canRespond: (interactionId: string) => boolean;
  /** The interaction to render. */
  readonly interaction: Interaction;
  /** Submits answers to questions and approvals. */
  readonly onInputResponses: OnInputResponses;
  /** The tool call the interaction concerns, if any. */
  readonly tool?: EveToolPart;
}) {
  if (interaction.request.kind === "question") {
    return (
      <QuestionRequest
        canRespond={canRespond(interaction.interactionId)}
        inputRequest={interaction}
        inputResponse={interaction.answer}
        onInputResponses={onInputResponses}
      />
    );
  }

  if (interaction.request.kind === "sign-in") {
    return <SignInPrompt interaction={interaction} />;
  }

  return (
    <InputRequestActions
      canRespond={canRespond(interaction.interactionId)}
      interaction={interaction}
      onInputResponses={onInputResponses}
      tool={tool}
    />
  );
}

function SignInPrompt({
  interaction,
}: {
  /** The sign-in interaction to render. */
  readonly interaction: Interaction;
}) {
  const { signIn } = interaction.request;
  const displayName = signIn?.displayName ?? signIn?.name;
  if (interaction.status === "settled") {
    const connected = interaction.outcome === "accepted";
    const Icon = connected ? CheckCircleIcon : XCircleIcon;
    return (
      <div className="text-muted-foreground flex w-full max-w-md items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon
          className={cn(
            "size-4 shrink-0",
            connected ? "text-success" : "text-destructive"
          )}
        />
        <span className="text-foreground font-medium">
          {signInEnding(interaction.outcome ?? "failed")}
        </span>
        <span className="truncate">{displayName}</span>
      </div>
    );
  }
  return (
    <div className="border-info/30 bg-info/5 w-full max-w-md space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Connect {displayName}</p>
        <p className="text-muted-foreground text-sm">
          {interaction.request.prompt}
        </p>
        {signIn?.instructions === undefined ||
        signIn.instructions === interaction.request.prompt ? null : (
          <p className="text-muted-foreground text-sm">{signIn.instructions}</p>
        )}
      </div>
      {signIn?.userCode === undefined ? null : (
        <div className="bg-background/60 flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Code</span>
          <code className="font-mono">{signIn.userCode}</code>
        </div>
      )}
      {signIn?.url === undefined ? null : (
        <Button asChild size="sm">
          <a href={signIn.url} rel="noreferrer" target="_blank">
            <ExternalLinkIcon className="size-4" />
            Sign in with {displayName}
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
 * Resolves a settled request to the text shown in place of its buttons.
 *
 * @param interaction - The settled interaction.
 * @returns The outcome, or `undefined` while the request is open.
 */
function settledOutcome(
  interaction: Interaction
):
  | { readonly approved: boolean | undefined; readonly label: string }
  | undefined {
  if (interaction.status === "open") {
    return undefined;
  }
  let approved: boolean | undefined;
  if (interaction.request.kind === "approval") {
    if (interaction.outcome === "accepted") {
      approved = true;
    } else if (interaction.outcome === "declined") {
      approved = false;
    }
  }
  const selected = interaction.request.options?.find(
    ({ id }) => id === interaction.answer?.optionId
  );
  let label = interaction.outcome ?? "Closed";
  if (approved !== undefined) {
    label = approved ? "Approved" : "Declined";
  }
  return {
    approved,
    label: selected?.label ?? interaction.answer?.text ?? label,
  };
}

/**
 * Asks the visitor to approve a tool call, showing what the call will do, then
 * shows the decision once made.
 *
 * @param props - The component props.
 * @returns The approval card, or `null` when the tool call asks for nothing.
 */
function InputRequestActions({
  canRespond,
  interaction,
  onInputResponses,
  tool,
}: {
  /** Whether the interaction remains answerable. */
  readonly canRespond: boolean;
  /** The interaction to show. */
  readonly interaction: Interaction;
  /** Submits the chosen option. */
  readonly onInputResponses: OnInputResponses;
  /** The tool call the interaction concerns, if any. */
  readonly tool?: EveToolPart;
}) {
  const isApproval = interaction.request.kind === "approval";
  const outcome = settledOutcome(interaction);
  const summary = inputSummarySchema.safeParse(tool?.input);
  const details = isApproval && summary.success ? summary.data : [];

  if (outcome !== undefined) {
    const Icon = outcome.approved === false ? XCircleIcon : CheckCircleIcon;
    return (
      <div className="text-muted-foreground flex w-full max-w-md items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <Icon
          className={cn(
            "size-4 shrink-0",
            outcome.approved === false ? "text-destructive" : "text-success"
          )}
        />
        <span className="text-foreground font-medium">{outcome.label}</span>
        {isApproval ? (
          <span className="truncate">
            {tool?.label ?? interaction.call?.name}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-warning/30 bg-warning/5 w-full max-w-md space-y-3 rounded-md border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {isApproval
            ? (tool?.label ?? interaction.call?.name)
            : interaction.request.prompt}
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
        {interaction.request.options?.map((option, index) => (
          <Button
            disabled={!canRespond}
            key={option.id}
            onClick={() => {
              void onInputResponses([
                {
                  optionId: option.id,
                  interactionId: interaction.interactionId,
                },
              ]);
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
      return part.interactionId;
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

function toolState(
  state: EveToolPart["state"]
):
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error" {
  switch (state) {
    case "streaming": {
      return "input-streaming";
    }
    case "completed": {
      return "output-available";
    }
    case "rejected": {
      return "output-denied";
    }
    case "failed": {
      return "output-error";
    }
    case "approval": {
      return "approval-requested";
    }
    case "blocked":
    case "requested":
    case "running": {
      return "input-available";
    }
    case "cancelled": {
      return "output-error";
    }
    default: {
      return "input-available";
    }
  }
}
