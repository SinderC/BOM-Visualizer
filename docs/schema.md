# BOM document format (version 1)

One XML file holds one `<bomDocument>`: shared option families and items, one or more BOMs, and alignments between BOM occurrences.

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
| `itemTypes` | Ordered list of allowed item `<type>` names. Optional; if absent, the defaults `Part`, `Assembly`, `Station` apply. |
| `item` | Part identity (`id`, `type`, `name`, `description`). `type` is optional and must be listed in `itemTypes`. Shared by all BOMs; may be used under many parents. |
| `bom` | `id`, `name`, `root` (item id). Holds its own relations. |
| `relation` | Parent→child usage: `id`, `parent`, `child`, `qty`, `findNo`. **Relation ids are unique across the whole document.** |
| `variant` | Optional boolean expression (see below). Missing/blank = always included. |
| `effectivity` | Optional. Dates are ISO `yyyy-mm-dd`, units are whole numbers of 1 or more; all bounds inclusive. Omitted bound = open; `unitTo` omitted (or `UP`) = up. |
| `alignment` | Link between two occurrences (`source`, `target`). Stored and round-tripped; no UI yet. |

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
primary := '(' or ')' | FAMILY ('=' | '!=') VALUE | FAMILY 'IN' '(' VALUE (',' VALUE)* ')'
```

- Keywords are case-insensitive; family and value names are case-sensitive.
- An unset family matches no value: `ENGINE=V8` is false and `ENGINE!=V8` is true.

## Load-time checks

Well-formed XML, `<bomDocument>` root, supported version, at least one BOM, unique item and relation ids, known item types, existing parent/child/root references, no cycles within a BOM.
