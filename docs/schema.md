# BOM document format (version 1)

One XML file holds one `<bomDocument>`: shared variant families and items, one or more BOMs, and alignments between BOM occurrences.

```xml
<bomDocument version="1">
  <optionFamilies>
    <family name="ENGINE"><value>V6</value><value>V8</value></family>
  </optionFamilies>
  <itemTypes>
    <type>Part</type><type>Assembly</type>
  </itemTypes>
  <items>
    <item id="A-1" type="Assembly" name="Car" description="optional"/>
  </items>
  <bom id="EBOM" name="Engineering BOM" root="A-1">
    <relations>
      <relation id="R1" parent="A-1" child="P-1" qty="1" findNo="10">
        <variant>ENGINE=V8 AND MARKET IN (EU, US)</variant>
        <effectivity dateFrom="2026-01-01" dateTo="2027-06-30" unitFrom="10" unitTo="499"/>
      </relation>
    </relations>
  </bom>
  <alignments>
    <alignment id="A1" source="EBOM:R1/R5" target="MBOM:R20/R7"/>
  </alignments>
</bomDocument>
```

## Elements

| Element | Notes |
|---|---|
| `bomDocument@version` | Format version. Readers reject versions newer than they support. |
| `family` | `name` + ordered `<value>` list. Shared by all BOMs. |
| `itemTypes` | Ordered list of allowed item `<type>` names. Optional; if absent, the defaults `Part Revision`, `Design Revision` apply. |
| `item` | Part identity (`id`, `type`, `name`, `description`). `type` is optional and must be listed in `itemTypes`. Shared by all BOMs; may be used under many parents. |
| `bom` | `id`, `name`, `root` (item id). Holds its own relations. |
| `relation` | Parent→child usage: `id`, `parent`, `child`, `qty`, `findNo`. **Relation ids are unique across the whole document.** |
| `variant` | Optional boolean expression (see below). Missing/blank = always included. |
| `effectivity` | Optional. Dates are ISO `yyyy-mm-dd`, units are whole numbers of 1 or more; all bounds inclusive. Omitted bound = open; `unitTo` omitted (or `UP`) = up. |
| `alignment` | Link between two occurrences in different BOMs (`source`, `target`). Edited in the alignment view; the app removes it when a relation is removed or moved so that either address no longer exists. Alignments to missing occurrences are kept on load but not shown. |

Unknown elements and attributes are ignored on load. New features are added as optional elements/attributes so older files keep loading.

## Occurrence address

An occurrence is one position of an item in a BOM tree. Because an item can be reused (e.g. a bolt in four places), an item id alone is not unique — the address is the BOM id plus the path of relation ids from the root:

```
EBOM:R2/R10/R11     bolt under wheel under chassis
EBOM:R1/R12         same bolt item, directly under body
EBOM:               the root occurrence
```

Alignments refer to occurrences by this address.

## Variant expressions

```
or      := and ('OR' and)*
and     := not ('AND' not)*
not     := 'NOT' not | primary
primary := '(' or ')' | NAME ('=' | '!=') NAME | NAME 'IN' '(' NAME (',' NAME)* ')'
NAME    := [A-Za-z0-9_.-]+ | '"' any character except '"' '"'
```

- Keywords are case-insensitive; family and value names are case-sensitive.
- A family or value name with other characters, such as spaces, or one that is a keyword is written in double quotes: `"Engine type" = "V6 Turbo"`. Names cannot contain `"`.
- An unset family matches no value: `ENGINE=V8` is false and `ENGINE!=V8` is true.

## CSV import

File > Import from CSV… builds a new BOM from rows of parent→child pairs. A preview shows what will be added (relations, new and reused items, the indented structure) and lets you set the BOM's name, prefilled from the file name, and type; nothing changes until Create.

```csv
Parent,ID,Name,Type,Description,Qty,FindNo,Variant,EffDateFrom,EffDateTo,EffUnitFrom,EffUnitTo
,A-100,Chassis,Assembly,Rolling chassis,,,,,,,
A-100,P-200,Wheel,Part,,4,10,,,,,
P-200,P-300,Wheel bolt,Part,M12x1.5,5,10,,,,,
A-100,P-400,Engine V8,Part,,1,20,ENGINE=V8,2026-01-01,,,
A-100,P-410,Engine V6,Part,,1,20,"ENGINE=V6 AND MARKET IN (EU, US)",,2027-06-30,10,UP
A-100,P-300,Wheel bolt,Part,,8,,,,,,
```

- A header row names the columns, in any order; case, spaces, dots, dashes and underscores are ignored (`Find No.` = `FindNo`). Only `Parent` and `ID` are required; other columns are ignored.
- The delimiter is `;` when the header has more semicolons than commas (as Excel saves in many European locales), else `,`. Fields with the delimiter, quotes or line breaks are quoted (`"…"`, `""` for a quote).
- Exactly one row has a blank `Parent`: the BOM root. Its relation columns are ignored.
- Every other row is one relation; the same pair on several rows is several usages. Each `Parent` must be the `ID` of some row.
- An `ID` already in the document reuses that item, unchanged. A new one is created from the first row with it; `Type` may be blank.
- `Qty` blank = 1; `FindNo` blank = next after the highest under the parent. `Variant` uses the expression syntax below.
- Item types, variant families and values the document lacks are listed in the preview under **Create missing item types and variant values** (checked by default); unchecked, they are problems. A new type's ID prefix is the start its items' IDs share up to the first digit (`G-100`, `G-101` → `G-`); new values are added after the family's existing ones. Effectivity as in the XML: `yyyy-mm-dd`, whole units of 1 or more, `UP` or blank = open.
- Any error blocks Create; the preview lists the problems by spreadsheet row number instead. The import is one undo step.

## Load-time checks

Well-formed XML, `<bomDocument>` root, supported version, at least one BOM, unique item and relation ids, known item types, existing parent/child/root references, no cycles within a BOM.
