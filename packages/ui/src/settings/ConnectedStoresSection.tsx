import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Globe2,
  Link2Off,
  Loader2,
  Store,
  XCircle,
} from "lucide-react";
import type {
  ConnectStoreOutcome,
  IStoresService,
  StoreConnectionRecord,
  TestConnectionOutcome,
} from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { cn } from "@/components/lib/utils.js";

/**
 * Connected Stores 设置分区（P4）。
 *
 * 所有文案走 i18n（en-US + zh-CN），样式只取现有语义 token；
 * 每个状态都诚实标注：连接档位（Tier）、权限（authority: read-only）、
 * 证据类别（evidence class）与平台原样的错误消息 —— 从不假装连接。
 */

type StorePlatformId = "shopify" | "woocommerce" | "etsy" | "ebay" | "amazon" | "whatnot";

interface PlatformTile {
  id: StorePlatformId;
  tier: "public" | "credential" | "web";
  needsCredentials: boolean;
}

const PLATFORM_TILES: PlatformTile[] = [
  { id: "shopify", tier: "public", needsCredentials: false },
  { id: "woocommerce", tier: "public", needsCredentials: false },
  { id: "etsy", tier: "credential", needsCredentials: true },
  { id: "ebay", tier: "credential", needsCredentials: true },
  { id: "amazon", tier: "credential", needsCredentials: true },
  { id: "whatnot", tier: "web", needsCredentials: false },
];
const STATUS_CHIP_STYLES: Record<string, string> = {
  connected: "bg-selected text-foreground",
  configured: "bg-surface text-foreground-subtle",
  error: "bg-surface text-warning",
  "web-searched": "bg-surface text-foreground-subtle",
};

function statusChipClass(status: string | undefined): string {
  return STATUS_CHIP_STYLES[status ?? ""] ?? "bg-surface text-foreground-subtle";
}

export function ConnectedStoresSection({ storesService }: { storesService?: IStoresService }) {
  const { intl } = useZCodeIntl();
  const confirmDialog = useConfirmDialog();

  const [stores, setStores] = useState<StoreConnectionRecord[] | null>(null);
  const [listReadError, setListReadError] = useState<string | undefined>(undefined);
  const [selectedPlatform, setSelectedPlatform] = useState<StorePlatformId | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [apiKeyString, setApiKeyString] = useState("");
  const [userToken, setUserToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Map<string, TestConnectionOutcome>>(new Map());

  const selectedTile = useMemo(
    () => PLATFORM_TILES.find((tile) => tile.id === selectedPlatform) ?? null,
    [selectedPlatform],
  );

  const refreshList = useCallback(async () => {
    if (!storesService) return;
    try {
      const result = await storesService.list();
      setStores(result.stores);
      setListReadError(result.readError);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  }, [storesService]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const resetForm = useCallback(() => {
    setUrl("");
    setLabel("");
    setApiKeyString("");
    setUserToken("");
    setSelectedPlatform(null);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!storesService || !selectedPlatform) return;
    setConnecting(true);
    try {
      const outcome: ConnectStoreOutcome = await storesService.connect({
        platform: selectedPlatform,
        url,
        ...(label.trim().length > 0 ? { label: label.trim() } : {}),
        ...(selectedTile?.needsCredentials && apiKeyString.trim() && userToken.trim()
          ? { credentials: { apiKeyString: apiKeyString.trim(), userToken: userToken.trim() } }
          : {}),
      });
      if (outcome.ok) {
        toast(outcome.message);
        resetForm();
        await refreshList();
      } else {
        // 平台原样错误 + 证据类别，诚实呈现 —— 绝不静默。
        toast(
          intl.formatMessage(
            { id: "settings.connectedStores.connectFailed" },
            { message: outcome.message },
          ),
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  }, [
    apiKeyString,
    intl,
    label,
    refreshList,
    resetForm,
    selectedPlatform,
    selectedTile,
    storesService,
    url,
    userToken,
  ]);

  const handleTest = useCallback(
    async (store: StoreConnectionRecord) => {
      if (!storesService) return;
      setTestingId(store.id);
      try {
        const result = await storesService.test({ id: store.id });
        setTestResults((previous) => new Map(previous).set(store.id, result));
        toast(result.message);
        await refreshList();
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      } finally {
        setTestingId(null);
      }
    },
    [refreshList, storesService],
  );

  const handleRevoke = useCallback(
    async (store: StoreConnectionRecord) => {
      if (!storesService) return;
      const confirmed = await confirmDialog({
        confirmVariant: "destructive",
        title: intl.formatMessage({ id: "settings.connectedStores.revoke.title" }),
        description: intl.formatMessage(
          { id: "settings.connectedStores.revoke.description" },
          { store: store.label },
        ),
        confirmLabel: intl.formatMessage({ id: "settings.connectedStores.revoke.confirm" }),
      });
      if (!confirmed) return;
      setRevokingId(store.id);
      try {
        const result = await storesService.remove({ id: store.id });
        if (result.ok) {
          toast(result.message);
          await refreshList();
        } else {
          toast(result.message);
        }
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error));
      } finally {
        setRevokingId(null);
      }
    },
    [confirmDialog, intl, refreshList, storesService],
  );

  if (!storesService) {
    return (
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.connectedStores.title" })}
          description={intl.formatMessage({ id: "settings.connectedStores.unavailable" })}
          control={<span />}
        />
      </SettingsGroupCard>
    );
  }

  const tierLabel = (tier: string) =>
    intl.formatMessage({ id: `settings.connectedStores.tier.${tier}` });
  const statusLabel = (status: string | undefined) =>
    status !== undefined
      ? intl.formatMessage({ id: `settings.connectedStores.status.${status}` })
      : intl.formatMessage({ id: "settings.connectedStores.status.unknown" });

  return (
    <div className="min-w-0 space-y-6">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.connectedStores.title" })}
          description={intl.formatMessage({ id: "settings.connectedStores.description" })}
          control={
            <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
              {intl.formatMessage({ id: "settings.connectedStores.authority.readOnly" })}
            </span>
          }
        />
        {listReadError !== undefined ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.connectedStores.readError" })}
            description={listReadError}
            control={<XCircle className="size-4 text-warning" />}
          />
        ) : null}
      </SettingsGroupCard>

      <SettingsGroupCard>
        {PLATFORM_TILES.map((tile) => (
          <SettingsRow
            key={tile.id}
            label={intl.formatMessage({ id: `settings.connectedStores.platform.${tile.id}` })}
            description={intl.formatMessage({
              id: `settings.connectedStores.platform.${tile.id}.description`,
            })}
            control={
              tile.id === "whatnot" ? (
                // Whatnot 无公开 API：诚实说明，绝不给一个假装连接的按钮。
                <span className="text-ui-xs text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.connectedStores.whatnot.note" })}
                </span>
              ) : (
                <Button
                  type="button"
                  variant={selectedPlatform === tile.id ? "default" : "secondary"}
                  size="sm"
                  onClick={() => {
                    setSelectedPlatform(selectedPlatform === tile.id ? null : tile.id);
                    setUrl("");
                    setLabel("");
                    setApiKeyString("");
                    setUserToken("");
                  }}
                >
                  {intl.formatMessage({ id: "settings.connectedStores.connect" })}
                </Button>
              )
            }
            detail={
              selectedPlatform === tile.id ? (
                <div className="space-y-3 pt-1">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={url}
                      onChange={(event) => setUrl(event.currentTarget.value)}
                      placeholder={intl.formatMessage({ id: "settings.connectedStores.url" })}
                      className="w-full"
                    />
                    <Input
                      value={label}
                      onChange={(event) => setLabel(event.currentTarget.value)}
                      placeholder={intl.formatMessage({
                        id: "settings.connectedStores.labelOptional",
                      })}
                      className="w-full"
                    />
                  </div>
                  {tile.needsCredentials ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        type="password"
                        autoComplete="off"
                        value={apiKeyString}
                        onChange={(event) => setApiKeyString(event.currentTarget.value)}
                        placeholder={intl.formatMessage({
                          id: "settings.connectedStores.etsy.keystring",
                        })}
                        className="w-full"
                      />
                      <Input
                        type="password"
                        autoComplete="off"
                        value={userToken}
                        onChange={(event) => setUserToken(event.currentTarget.value)}
                        placeholder={intl.formatMessage({
                          id: "settings.connectedStores.etsy.userToken",
                        })}
                        className="w-full"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={connecting || url.trim().length === 0}
                      onClick={() => void handleConnect()}
                    >
                      {connecting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Store className="size-4" />
                      )}
                      {intl.formatMessage({ id: "settings.connectedStores.connect" })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetForm}
                    >
                      {intl.formatMessage({ id: "common.cancel" })}
                    </Button>
                  </div>
                </div>
              ) : null
            }
          />
        ))}
      </SettingsGroupCard>

      <SettingsGroupCard>
        {stores === null ? (
          <SettingsRow
            label={intl.formatMessage({ id: "common.loading" })}
            control={<Loader2 className="size-4 animate-spin text-foreground-subtle" />}
          />
        ) : stores.length === 0 ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.connectedStores.empty" })}
            control={<Store className="size-4 text-foreground-subtle" />}
          />
        ) : (
          stores.map((store) => {
            const testResult = testResults.get(store.id);
            return (
              <SettingsRow
                key={store.id}
                label={
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-semibold">{store.label}</span>
                    <span className="rounded-md bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                      {store.platform}
                    </span>
                    <span className="rounded-md bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                      {tierLabel(store.tier)}
                    </span>
                    {store.tier !== "web" ? (
                      <span className="rounded-md bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.connectedStores.authority.readOnly" })}
                      </span>
                    ) : null}
                  </span>
                }
                description={
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-1 text-ui-sm">
                      <Globe2 className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{store.domain}</span>
                    </span>
                    <span
                      className={cn(
                        "w-fit rounded-md px-2 py-0.5 text-ui-xs font-medium",
                        statusChipClass(store.status),
                      )}
                    >
                      {statusLabel(store.status)}
                      {store.lastCheckCode !== undefined ? ` · ${store.lastCheckCode}` : ""}
                    </span>
                    {testResult !== undefined ? (
                      <span className="flex items-start gap-1 text-ui-xs text-foreground-subtle">
                        {testResult.ok ? (
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                        ) : (
                          <XCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                        )}
                        <span className="min-w-0 break-words">
                          {testResult.message}
                          <span className="ml-1 opacity-70">({testResult.evidenceClass})</span>
                        </span>
                      </span>
                    ) : null}
                  </span>
                }
                control={
                  <span className="flex flex-nowrap items-center gap-2">
                    {store.tier !== "web" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={testingId !== null || connecting}
                        onClick={() => void handleTest(store)}
                      >
                        {testingId === store.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        {intl.formatMessage({ id: "settings.connectedStores.test" })}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revokingId !== null}
                      onClick={() => void handleRevoke(store)}
                    >
                      {revokingId === store.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Link2Off className="size-4" />
                      )}
                      {intl.formatMessage({ id: "settings.connectedStores.revoke" })}
                    </Button>
                  </span>
                }
              />
            );
          })
        )}
      </SettingsGroupCard>
    </div>
  );
}
