# `api.py` Cheatsheet

The official Python CLI shipped in the WeKan repo root: `https://github.com/wekan/wekan/blob/main/api.py`. It has the **widest and most current API coverage** — often ahead of the wiki and the generated Redoc docs. Consult it when something isn't documented elsewhere, especially for attachments, admin settings, and Trello/Jira/etc. imports.

## Big-picture caveats

- **Password-based admin login only.** `api.py` explicitly notes it does not work with LDAP or OAuth2/OIDC accounts.
- **Credentials are stored inside the file.** Users edit the top of `api.py` to set the WeKan URL, admin email, and password. This is a documented security tradeoff — do not check in edited copies.
- The CLI is a **thin wrapper**: each command maps to one or a few REST calls. Reading it is the fastest way to discover the raw HTTP shape for a given operation.

## How to use it as a reference

When you need the current URL/method for a WeKan operation:

1. Fetch `https://raw.githubusercontent.com/wekan/wekan/main/api.py` (or from the pinned version tag).
2. Search for the command name (e.g. `uploadattachment`).
3. Read the function it dispatches to — you'll see the `requests` call with the exact URL path, method, headers, and body shape.

## Command inventory

Commands are grouped below by topic. Argument names are the CLI positional argument names; verify current signatures against the file.

### Auth and info

- `login` — hits `POST /users/login`, prints the token.
- `getcurrentuser` — `GET /api/user` for the token owner.
- `getpublicboards` — `GET /public`.

### Users (admin)

- `getuser USERID`
- `getusers` — `GET /api/users`
- `createuser USERNAME EMAIL PASSWORD`
- `deleteuser USERID`
- `getuserboards USERID`

### Boards

- `getboard BOARDID`
- `getboards` — user's boards
- `getpublicboards`
- `createboard TITLE OWNER [PERMISSION] [COLOR]`
- `deleteboard BOARDID`
- `copyboard BOARDID`
- `exportboard BOARDID OUTPUTPATH`
- `getboardslug BOARDID`

### Board members

- `addmembertoboard BOARDID USERID`
- `removefromboard BOARDID USERID`
- `changepermission BOARDID USERID isAdmin isNoComments isCommentOnly isWorker`

### Labels

- `addlabel BOARDID NAME COLOR`

### Lists

- `getlists BOARDID`
- `getlist BOARDID LISTID`
- `createlist BOARDID TITLE`
- `deletelist BOARDID LISTID`

### Swimlanes

- `getswimlanes BOARDID`
- `getswimlane BOARDID SWIMLANEID`
- `createswimlane BOARDID TITLE`
- `deleteswimlane BOARDID SWIMLANEID`
- `getcardsinswimlane BOARDID SWIMLANEID`

### Cards

- `getcard BOARDID LISTID CARDID`
- `getcards BOARDID LISTID`
- `createcard BOARDID LISTID SWIMLANEID TITLE DESCRIPTION AUTHORID`
- `editcard BOARDID LISTID CARDID TITLE DESCRIPTION LABELIDS MEMBERS ASSIGNEES ...`
- `deletecard BOARDID LISTID CARDID`
- `movecard BOARDID FROMLISTID CARDID TOLISTID`
- `getcardscount BOARDID`

### Checklists and items

- `getchecklists BOARDID CARDID`
- `getchecklist BOARDID CARDID CHECKLISTID`
- `createchecklist BOARDID CARDID TITLE`
- `deletechecklist BOARDID CARDID CHECKLISTID`
- `getchecklistitem BOARDID CARDID CHECKLISTID ITEMID`
- `createchecklistitem BOARDID CARDID CHECKLISTID TITLE`
- `editchecklistitem BOARDID CARDID CHECKLISTID ITEMID TITLE ISFINISHED`
- `deletechecklistitem BOARDID CARDID CHECKLISTID ITEMID`

### Comments

- `getcomments BOARDID CARDID`
- `getcomment BOARDID CARDID COMMENTID`
- `createcomment BOARDID CARDID AUTHORID COMMENT`
- `deletecomment BOARDID CARDID COMMENTID`

### Automation rules (IFTTT, #2674)

- `listrules BOARDID`
- `getrule BOARDID RULEID`
- `addrule BOARDID TITLE TRIGGER_JSON ACTION_JSON` — omitted trigger matching fields default to the `'*'` wildcard
- `editrule BOARDID RULEID PATCH_JSON` — `{"title":..,"trigger":{..},"action":{..}}`
- `removerule BOARDID RULEID` — removes the rule and its trigger + action
- Action text fields (`sendEmail`'s `emailTo`/`emailSubject`/`emailMsg`, created card/checklist/swimlane names) support `{cardname}`-style variables — see the [template variables table](rest-api-overview.md#automation-rules).

### Custom fields

- `getcustomfields BOARDID`
- `getcustomfield BOARDID FIELDID`
- `createcustomfield BOARDID NAME TYPE SETTINGS ...`
- `editcustomfield BOARDID FIELDID ...`
- `deletecustomfield BOARDID FIELDID`
- `edit_card_custom_field BOARDID CARDID FIELDID VALUE` — set the field on a specific card

### Integrations (webhooks)

- `getintegrations BOARDID`
- `getintegration BOARDID INTID`
- `createintegration BOARDID URL`
- `editintegration BOARDID INTID ...`
- `deleteintegration BOARDID INTID`

### Attachments (this is the biggest gap the wiki has)

- `listattachments BOARDID`
- `listcardattachments BOARDID SWIMLANEID LISTID CARDID`
- `attachmentinfo ATTACHMENTID`
- `uploadattachment BOARDID SWIMLANEID LISTID CARDID FILEPATH [STORAGE_BACKEND]`
  - `STORAGE_BACKEND` is one of `fs`, `gridfs`, `s3` (server must have the backend configured).
- `downloadattachment ATTACHMENTID OUTPUTPATH`
- `deleteattachment ATTACHMENTID`
- `copymoveattachment ATTACHMENTID TARGET_BOARDID TARGET_SWIMLANEID TARGET_LISTID TARGET_CARDID MODE`
  - `MODE` is `copy` or `move`.
- `uploadbackground BOARDID FILEPATH`
- `downloadbackground BOARDID OUTPUTPATH`

### Admin settings

- `getsettings` — `GET /api/settings`
- `editsetting DOTTED.FIELD VALUE` — `PUT /api/settings`
- `attachmentsettings` — `GET /api/admin/attachment-settings`
- `editattachmentsetting DOTTED.FIELD VALUE` — `PUT /api/admin/attachment-settings`

### Imports

- `importtrelloboard JSONFILE`
- `importwekanboard JSONFILE`
- Also see the docs/ folder for CSV/Jira imports.

### Miscellaneous

- `exportboardpdf BOARDID OUTPUTPATH` — PDF export
- `getcardsbycustomfield BOARDID FIELDID VALUE`

## When to reach for `api.py` directly

- The user wants the fastest possible one-off script for an operation they'll run manually — hand them `api.py` and the command name.
- You need the current URL for an operation that the wiki calls "TODO" or that has no wiki page.
- You're supporting a new-ish WeKan version and the Redoc docs are much older.

## When *not* to use `api.py`

- Long-lived server code: it stores credentials in-file.
- Environments without a Python 3 runtime.
- When the caller needs an object model (`Board.cards`, `Card.checklists`, etc.) — use `python-wekan` instead.
