import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Compass, FolderGit2, Github, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import infoImageUrl from "@/assets/images/info.webp";
import type { AppInfo } from "@preload/index.d";

interface AppInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartTour?: () => void;
}

const PROJECT_REPO_URL = "https://github.com/blackwaterbread/Konomi";
const CREATOR_GITHUB_URL = "https://github.com/blackwaterbread";
const OPEN_SOURCE_LICENSE_TEXT = `Apache 2.0 licensed packages used by Konomi

- prisma 7.4.2
  Source: https://github.com/prisma/prisma
  LICENSE: https://github.com/prisma/prisma/blob/main/LICENSE

- @prisma/client 7.4.2
  Source: https://github.com/prisma/prisma
  LICENSE: https://github.com/prisma/prisma/blob/main/LICENSE

- @prisma/adapter-better-sqlite3 7.4.2
  Source: https://github.com/prisma/prisma
  LICENSE: https://github.com/prisma/prisma/blob/main/LICENSE

- class-variance-authority 0.7.1
  Source: https://github.com/joe-bell/cva
  LICENSE: https://github.com/joe-bell/cva/blob/main/LICENSE

- typescript 5.9.3
  Source: https://github.com/microsoft/TypeScript
  LICENSE: https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt

The packages above are distributed under the Apache License, Version 2.0.
Below is the license text as published in their GitHub LICENSE files.

Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and
distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the
copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other
entities that control, are controlled by, or are under common control with
that entity. For the purposes of this definition, "control" means (i) the
power, direct or indirect, to cause the direction or management of such
entity, whether by contract or otherwise, or (ii) ownership of fifty percent
(50%) or more of the outstanding shares, or (iii) beneficial ownership of
such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation source, and
configuration files.

"Object" form shall mean any form resulting from mechanical transformation or
translation of a Source form, including but not limited to compiled object
code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form,
made available under the License, as indicated by a copyright notice that is
included in or attached to the work (an example is provided in the Appendix
below).

"Derivative Works" shall mean any work, whether in Source or Object form,
that is based on (or derived from) the Work and for which the editorial
revisions, annotations, elaborations, or other modifications represent, as a
whole, an original work of authorship. For the purposes of this License,
Derivative Works shall not include works that remain separable from, or
merely link (or bind by name) to the interfaces of, the Work and Derivative
Works thereof.

"Contribution" shall mean any work of authorship, including the original
version of the Work and any modifications or additions to that Work or
Derivative Works thereof, that is intentionally submitted to Licensor for
inclusion in the Work by the copyright owner or by an individual or Legal
Entity authorized to submit on behalf of the copyright owner. For the
purposes of this definition, "submitted" means any form of electronic, verbal,
or written communication sent to the Licensor or its representatives,
including but not limited to communication on electronic mailing lists, source
code control systems, and issue tracking systems that are managed by, or on
behalf of, the Licensor for the purpose of discussing and improving the Work,
but excluding communication that is conspicuously marked or otherwise
designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on
behalf of whom a Contribution has been received by Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable copyright license to
reproduce, prepare Derivative Works of, publicly display, publicly perform,
sublicense, and distribute the Work and such Derivative Works in Source or
Object form.

3. Grant of Patent License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this
section) patent license to make, have made, use, offer to sell, sell, import,
and otherwise transfer the Work, where such license applies only to those
patent claims licensable by such Contributor that are necessarily infringed by
their Contribution(s) alone or by combination of their Contribution(s) with
the Work to which such Contribution(s) was submitted. If You institute patent
litigation against any entity (including a cross-claim or counterclaim in a
lawsuit) alleging that the Work or a Contribution incorporated within the Work
constitutes direct or contributory patent infringement, then any patent
licenses granted to You under this License for that Work shall terminate as of
the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or
Derivative Works thereof in any medium, with or without modifications, and in
Source or Object form, provided that You meet the following conditions:

(a) You must give any other recipients of the Work or Derivative Works a copy
of this License; and

(b) You must cause any modified files to carry prominent notices stating that
You changed the files; and

(c) You must retain, in the Source form of any Derivative Works that You
distribute, all copyright, patent, trademark, and attribution notices from
the Source form of the Work, excluding those notices that do not pertain to
any part of the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its distribution,
then any Derivative Works that You distribute must include a readable copy of
the attribution notices contained within such NOTICE file, excluding those
notices that do not pertain to any part of the Derivative Works, in at least
one of the following places: within a NOTICE text file distributed as part of
the Derivative Works; within the Source form or documentation, if provided
along with the Derivative Works; or, within a display generated by the
Derivative Works, if and wherever such third-party notices normally appear.
The contents of the NOTICE file are for informational purposes only and do not
modify the License. You may add Your own attribution notices within Derivative
Works that You distribute, alongside or as an addendum to the NOTICE text from
the Work, provided that such additional attribution notices cannot be
construed as modifying the License.

You may add Your own copyright statement to Your modifications and may provide
additional or different license terms and conditions for use, reproduction, or
distribution of Your modifications, or for any such Derivative Works as a
whole, provided Your use, reproduction, and distribution of the Work otherwise
complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any
Contribution intentionally submitted for inclusion in the Work by You to the
Licensor shall be under the terms and conditions of this License, without any
additional terms or conditions. Notwithstanding the above, nothing herein
shall supersede or modify the terms of any separate license agreement you may
have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names,
trademarks, service marks, or product names of the Licensor, except as
required for reasonable and customary use in describing the origin of the Work
and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in
writing, Licensor provides the Work (and each Contributor provides its
Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied, including, without limitation, any warranties
or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any risks
associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in
tort (including negligence), contract, or otherwise, unless required by
applicable law (such as deliberate and grossly negligent acts) or agreed to in
writing, shall any Contributor be liable to You for damages, including any
direct, indirect, special, incidental, or consequential damages of any
character arising as a result of this License or out of the use or inability
to use the Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all other
commercial damages or losses), even if such Contributor has been advised of
the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work
or Derivative Works thereof, You may choose to offer, and charge a fee for,
acceptance of support, warranty, indemnity, or other liability obligations
and/or rights consistent with this License. However, in accepting such
obligations, You may act only on Your own behalf and on Your sole
responsibility, not on behalf of any other Contributor, and only if You agree
to indemnify, defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason of your
accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS`;

export function AppInfoDialog({
  open,
  onOpenChange,
  onStartTour,
}: AppInfoDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    window.appInfo
      .get()
      .then((info) => setAppInfo(info))
      .catch(() => setAppInfo(null))
      .finally(() => setLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,72rem)] max-w-4xl overflow-hidden p-0">
        <div className="flex flex-col">
          <section className="relative bg-gradient-to-br from-primary/15 via-background to-secondary/40 p-8 sm:p-10">
            <DialogHeader className="mb-8">
              <div className="flex items-center gap-4">
                <img
                  src={infoImageUrl}
                  alt=""
                  aria-hidden="true"
                  className="h-14 w-14 rounded-2xl border border-primary/30 object-cover shadow-sm"
                />
                <div>
                  <DialogTitle className="text-2xl tracking-tight">
                    Konomi
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-relaxed">
                    {t("appInfoDialog.tagline")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-6 border-t border-border/60 pt-5">
              <div className="flex flex-col items-start gap-2">
                <a
                  href={PROJECT_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open project GitHub repository"
                  title="Repository GitHub"
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <FolderGit2 className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    {t("appInfoDialog.repository")}
                  </span>
                </a>
                <a
                  href={CREATOR_GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open creator GitHub profile"
                  title="Creator GitHub"
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Github className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    {t("appInfoDialog.author")}
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => setLicenseOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <FolderGit2 className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    {t("appInfoDialog.licenses")}
                  </span>
                </button>
                {onStartTour && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onStartTour();
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    <Compass className="h-5 w-5" />
                    <span className="text-sm font-medium">
                      {t("appInfoDialog.featureTour")}
                    </span>
                  </button>
                )}
              </div>
              {loading && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("appInfoDialog.loadingInfo")}</span>
                </div>
              )}
            </div>
          </section>

          <section className="border-t border-border/60 bg-background/95 px-8 py-5 sm:px-10">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
              {t("appInfoDialog.environment")}
            </p>
            {loading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("appInfoDialog.loadingEnvironment")}</span>
              </div>
            ) : (
              <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono text-sm text-foreground">
                {`${appInfo?.appName ?? "Konomi"} v${appInfo?.appVersion ?? "-"} · Electron ${appInfo?.electronVersion ?? "-"} · Node ${appInfo?.nodeVersion ?? "-"} · Chrome ${appInfo?.chromeVersion ?? "-"} · Platform ${appInfo ? `${appInfo.platform} (${appInfo.arch})` : "-"}`}
              </p>
            )}
          </section>
        </div>
      </DialogContent>

      <Dialog open={licenseOpen} onOpenChange={setLicenseOpen}>
        <DialogContent className="w-[min(92vw,56rem)] max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("appInfoDialog.licenses")}</DialogTitle>
            <DialogDescription>
              {t("appInfoDialog.licensesDescription")}
            </DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={OPEN_SOURCE_LICENSE_TEXT}
            className="min-h-[24rem] w-full resize-none rounded-lg border border-border/60 bg-secondary/30 px-3 py-3 font-mono text-xs leading-6 text-foreground outline-none"
          />
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
